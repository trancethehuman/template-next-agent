import { z } from "zod";
import {
  CalendarIntegrationError,
  findCalendarAvailability,
  getCalendarStatus,
} from "../../lib/assistant/calendar";
import {
  validateCalendarEventDraft,
} from "../../lib/assistant/calendar-event-schema";
import type { CalendarEventDraft } from "../../lib/assistant/calendar-event-schema";
import { AssistantBackendError, requestTaskBackend } from "./task-backend";
import type { AssistantActor } from "../../lib/auth/actor";

interface ProposalConnection {
  state: string;
  message: string;
  writeEnabled?: boolean;
  capabilities?: { createEvent?: boolean };
}

interface CalendarProposalDependencies {
  writeEnabled?: () => boolean;
  connection?: (actor: AssistantActor) => Promise<ProposalConnection>;
  availability?: typeof findCalendarAvailability;
  backend?: typeof requestTaskBackend;
  now?: () => Date;
}

export function createCalendarEventProposal(dependencies: CalendarProposalDependencies = {}) {
  const enabled = dependencies.writeEnabled
    ?? (() => process.env.ASSISTANT_CALENDAR_WRITE_ENABLED === "true");
  const connection = dependencies.connection ?? getCalendarStatus;
  const availability = dependencies.availability ?? findCalendarAvailability;
  const backend = dependencies.backend ?? requestTaskBackend;
  const now = dependencies.now ?? (() => new Date());

  return async function proposeCalendarEvent(actor: AssistantActor, raw: unknown, idempotencyKey: string) {
    if (!enabled()) return {
      proposed: false as const,
      error: "calendar_writes_disabled",
      message: "Calendar event creation is disabled. Enable ASSISTANT_CALENDAR_WRITE_ENABLED and reconnect Google Calendar with event-creation permission. Calendar reads remain available.",
    };
    let eventDraft: CalendarEventDraft;
    try {
      eventDraft = validateCalendarEventDraft(raw, now());
    } catch (error) {
      return {
        proposed: false as const,
        error: "invalid_event_draft",
        message: error instanceof z.ZodError
          ? `Check the event draft: ${error.issues[0]?.message ?? "Invalid event fields."}`
          : "Choose an event start in the future, within the next 365 days.",
      };
    }
    try {
      const calendar = await connection(actor);
      if (calendar.state !== "connected") return {
        proposed: false as const,
        error: calendar.state,
        message: calendar.message,
      };
      if (!calendar.writeEnabled || !calendar.capabilities?.createEvent) return {
        proposed: false as const,
        error: "calendar_write_permission_required",
        message: "The connected calendar is not authorized for event creation. Reconnect Google Calendar with the configured event-creation scope before proposing a live event.",
      };
      const freeBusy = await availability(actor, {
        timeMin: eventDraft.start,
        timeMax: eventDraft.end,
        durationMinutes: (Date.parse(eventDraft.end) - Date.parse(eventDraft.start)) / 60_000,
        timeZone: eventDraft.timeZone,
      });
      const available = freeBusy.slots.some(slot =>
        Date.parse(slot.start) <= Date.parse(eventDraft.start)
        && Date.parse(slot.end) >= Date.parse(eventDraft.end),
      );
      const task = await backend<{ runId: string }>(actor, "/api/assistant/tasks", {
        method: "POST",
        body: { kind: "calendar_event", eventDraft },
        idempotencyKey,
      });
      return {
        proposed: true as const,
        kind: "calendar_event" as const,
        runId: task.runId,
        eventDraft,
        availability: {
          state: available ? "free" as const : "conflict" as const,
          checkedAt: now().toISOString(),
        },
        destination: "/assistant",
        message: "Calendar event proposal accepted for owner review. Open its task inbox entry and review the exact event before approving creation. This receipt does not confirm a Google Calendar write; inspect the completed task for the returned event ID and link.",
      };
    } catch (error) {
      return {
        proposed: false as const,
        error: error instanceof CalendarIntegrationError ? error.code : "calendar_proposal_unavailable",
        message: error instanceof AssistantBackendError || error instanceof CalendarIntegrationError
          ? error.message
          : "The calendar proposal could not be prepared. Check Calendar access and the task inbox before retrying; no Calendar write was attempted by this tool.",
      };
    }
  };
}

export const proposeCalendarEvent = createCalendarEventProposal();

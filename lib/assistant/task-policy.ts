import { z } from "zod";
import { calendarEventDraftSchema } from "./calendar-event-schema";
import { assistantDemoStops } from "./types";
import { assistantModels, type AssistantModelId } from "./models";
import type {
  AssistantTask,
  AssistantTaskInput,
  TaskAction,
  TaskEvent,
  TaskStatus,
} from "./types";

export const defaultAssistantPreference = {
  bulletCount: 3,
  includeLinks: true,
} as const;

export function taskFailureMessage(error: unknown): string {
  const message =
    typeof error === "string"
      ? error
      : typeof error === "object" &&
          error !== null &&
          "message" in error &&
          typeof error.message === "string"
        ? error.message
        : "";
  if (message.includes("ASSISTANT_GOOGLE_CONNECTOR"))
    return "Google Calendar is not configured. Set ASSISTANT_GOOGLE_CONNECTOR and authorize the connection before starting another task.";
  if (message.includes("AI_GATEWAY_API_KEY"))
    return "Model access is not configured. Set AI_GATEWAY_API_KEY for local development before starting another task.";
  return "The meeting brief could not be prepared. Check the calendar connection and model access, then start a new task. No meeting information was invented.";
}
/** A calendar watch fails without inventing anything; the next step is always a new watch. */
export function calendarWatchFailureMessage(error: unknown): string {
  const message = taskFailureMessage(error);
  return message.startsWith("The meeting brief")
    ? "Your calendar could not be read. Check the connection on the Always-on tab, then start a new watch. Nothing was flagged or sent."
    : message;
}
export const assistantPreferenceSchema = z.object({
  bulletCount: z.union([z.literal(3), z.literal(5)]),
  includeLinks: z.boolean(),
});
export const assistantTaskSchema = z
  .object({
    kind: z.enum(["meeting_prep", "calendar_event", "calendar_watch"]).default("meeting_prep"),
    eventDraft: calendarEventDraftSchema.optional(),
    title: z
      .string()
      .trim()
      .min(1)
      .max(120)
      .default("Prepare for my next meeting"),
    prompt: z
      .string()
      .trim()
      .max(2000)
      .default(
        "Prepare a short meeting brief from my calendar and available notes.",
      ),
    mode: z.enum(["rehearsal", "calendar"]).default("rehearsal"),
    delaySeconds: z.number().int().min(0).max(86400).default(0),
    manualStart: z.boolean().default(false),
    demoMode: z.boolean().default(false),
    approvalRequired: z.boolean().default(true),
    sourceVersion: z.union([z.literal(1), z.literal(2)]).default(1),
    maxChecks: z.number().int().min(1).max(5).default(3),
    preference: assistantPreferenceSchema.default(defaultAssistantPreference),
    calendarEventId: z.string().min(1).max(512).optional(),
    model: z.enum(assistantModels.map((model) => model.id) as [AssistantModelId, ...AssistantModelId[]]).optional(),
    timeMin: z.iso.datetime({ offset: true }).optional(),
    timeMax: z.iso.datetime({ offset: true }).optional(),
  })
  .superRefine((input, context) => {
    if (
      input.demoMode &&
      (input.mode !== "rehearsal" || input.kind !== "meeting_prep")
    )
      context.addIssue({
        code: "custom",
        path: ["demoMode"],
        message: "Guided demonstrations use fictional meeting preparation.",
      });
    if (input.kind === "calendar_event" && !input.eventDraft)
      context.addIssue({
        code: "custom",
        path: ["eventDraft"],
        message: "An exact event draft is required.",
      });
    if (input.kind === "meeting_prep" && input.eventDraft)
      context.addIssue({
        code: "custom",
        path: ["eventDraft"],
        message: "Meeting preparation cannot contain a calendar write.",
      });
    if (input.kind === "calendar_watch" && input.eventDraft)
      context.addIssue({
        code: "custom",
        path: ["eventDraft"],
        message: "A calendar watch only reads your calendar.",
      });
  });
export const taskActionSchema = z.object({
  action: z.enum([
    "start",
    "wake",
    "pause",
    "resume",
    "approve",
    "deny",
    "cancel",
    "replay",
    "update-source",
    "finish",
    "advance",
    "play",
  ]),
  requestId: z.string().regex(/^[A-Za-z0-9:_-]{8,128}$/),
  expectedCheckpointId: z.string().min(1).max(200).optional(),
  stopAt: z.enum(assistantDemoStops).optional(),
}).refine((value) => !value.stopAt || value.action === "play", {
  message: "Only Play can stop at a stage.",
  path: ["stopAt"],
});

export function allowedTaskActions(
  status: TaskStatus,
  mode: AssistantTaskInput["mode"],
): TaskAction[] {
  switch (status) {
    case "queued":
      return ["start", "cancel"];
    case "paused":
      return ["resume", "cancel"];
    case "awaiting_approval":
      return ["approve", "deny", "cancel"];
    case "sleeping":
      return [
        "wake",
        "pause",
        "replay",
        ...(mode === "rehearsal" ? ["update-source" as const] : []),
        "finish",
        "cancel",
      ];
    case "running":
      return ["cancel"];
    default:
      return [];
  }
}

export function projectAssistantTask(
  run: { runId: string; status: string; createdAt: Date; completedAt?: Date },
  rawEvents: TaskEvent[],
): AssistantTask {
  // Stable IDs make retry/reconnect delivery at least once without duplicate alerts.
  const events = [
    ...new Map(rawEvents.map((event) => [event.id, event])).values(),
  ];
  const input = events.find((event) => event.input)?.input;
  const last = events.at(-1);
  const terminal = ["completed", "cancelled", "failed"].includes(run.status);
  const lastEventStatus = events.filter((event) => event.status).at(-1)?.status;
  const status: TaskStatus = terminal
    ? run.status === "completed" && lastEventStatus === "cancelled"
      ? "cancelled"
      : (run.status as TaskStatus)
    : (events.filter((event) => event.status).at(-1)?.status ?? "queued");
  const generatedBrief = events
    .filter((event) => event.type === "brief")
    .at(-1)?.content;
  const brief = generatedBrief ?? input?.restart?.prepared?.content;
  const sourceVersion = events.filter((event) => event.type === "source").at(-1)
    ?.sources?.[0]?.version;
  const kind = input?.kind ?? "meeting_prep";
  const calendarWriteApproved = events.some(
    (event) => event.calendarDecision === "approved",
  );
  const demoEvent = events.filter((event) => event.demoStage).at(-1);
  const demo =
    input?.demoMode && input.mode === "rehearsal" && demoEvent?.demoStage
      ? {
          stage: demoEvent.demoStage,
          waitingForStep: !terminal && Boolean(demoEvent.demoGate),
          playback: demoEvent.demoPlayback ?? ("step" as const),
          ...(demoEvent.demoStopAt ? { stopAt: demoEvent.demoStopAt } : {}),
        }
      : undefined;
  return {
    runId: run.runId,
    title: input?.title ?? "Meeting preparation",
    prompt: input?.prompt ?? "",
    mode: input?.mode ?? "rehearsal",
    status,
    workflowStatus: run.status,
    createdAt: run.createdAt.toISOString(),
    updatedAt:
      run.completedAt?.toISOString() ??
      last?.occurredAt ??
      run.createdAt.toISOString(),
    events,
    brief,
    briefReused: !generatedBrief && Boolean(brief),
    restart: input?.restart,
    demo,
    error: events.find((event) => event.type === "error")?.detail,
    notificationCount: events.filter((event) => event.type === "notification")
      .length,
    sourceVersion: sourceVersion === "2" ? 2 : 1,
    preference: input?.preference ?? defaultAssistantPreference,
    allowedActions:
      kind === "calendar_event"
        ? status === "awaiting_approval" && !calendarWriteApproved
          ? ["approve", "deny", "cancel"]
          : []
        : demo?.waitingForStep && status === "paused"
          ? ["advance", "play", "cancel"]
          : demo?.waitingForStep && status === "running"
            ? ["pause", "cancel"]
            : !input && status === "queued"
              ? ["cancel"]
              : last?.title === "Scheduled wake-up" && status === "sleeping"
                ? ["wake", "cancel"]
                : allowedTaskActions(status, input?.mode ?? "rehearsal").filter(
                    // A watch rereads on Check now; there is no fixed event to replay.
                    (action) => kind !== "calendar_watch" || action !== "replay",
                  ),
    checkpointId: events.filter((event) => event.status).at(-1)?.id,
    kind,
    eventDraft: input?.eventDraft,
    calendarEvent: events.find((event) => event.type === "calendar_event")
      ?.calendarEvent,
  };
}

export function syntheticMeeting(version: 1 | 2) {
  return {
    id: "synthetic-design-review",
    title: "Product design review",
    start: "Tomorrow, 10:00 AM",
    timeZone: "America/Toronto",
    agenda:
      version === 1
        ? "Review the onboarding flow and agree on the launch checklist."
        : "Review the onboarding flow, agree on the launch checklist, and prepare a revised accessibility audit.",
    notes:
      "Fictional project notes: the team needs a clear first-run experience. The decision is whether to ship the compact navigation. Bring the open questions and proposed next steps.",
    version: String(version),
  };
}

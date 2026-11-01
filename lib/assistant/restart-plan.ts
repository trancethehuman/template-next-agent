import { z } from "zod";
import type { AssistantActor } from "@/lib/auth/actor";
import { validateCalendarEventDraft } from "./calendar-event-schema";
import { projectTaskFlow } from "./flow-presentation";
import { assistantTaskSchema } from "./task-policy";
import { AssistantTaskError } from "./task-errors";
import type {
  AssistantTask,
  TaskEvent,
  TaskRestartPhase,
  TaskRestartState,
  TaskSource,
} from "./types";

export const taskRestartSchema = z
  .object({
    eventId: z.string().min(1).max(200),
    requestId: z.string().regex(/^[A-Za-z0-9:_-]{8,128}$/),
  })
  .strict();

export interface TaskRestartPlan {
  input: z.infer<typeof assistantTaskSchema>;
  restart: TaskRestartState;
}

function rehearsalKey(sources?: TaskSource[]): string {
  const source = sources?.[0];
  return source && ["1", "2"].includes(source.version)
    ? `${source.id}:${source.version}`
    : "";
}

function liveSourceKey(value: unknown): string {
  return typeof value === "string" && /^[a-f0-9]{64}$/i.test(value)
    ? value.toLowerCase()
    : "";
}

function phaseForEvent(event?: TaskEvent): TaskRestartPhase {
  if (!event) return "complete";
  if (event.demoStage) return event.demoStage;
  if (
    event.type === "restart" &&
    event.input?.restart?.phase &&
    [
      "read",
      "prepare",
      "review",
      "deliver",
      "watch",
      "complete",
      "calendar_review",
    ].includes(event.input.restart.phase)
  )
    return event.input.restart.phase;
  if (event.type === "error") return "read";
  if (["completed", "cancelled", "failed"].includes(event.status ?? ""))
    return "complete";
  if (
    event.type === "notification" ||
    event.type === "approval" ||
    event.status === "awaiting_approval"
  )
    return "review";
  if (event.status === "sleeping" || event.status === "paused") return "watch";
  if (event.type === "brief") return "prepare";
  return "read";
}

/** The caller supplies an owned task, never a client-supplied state snapshot. */
export function planAssistantTaskRestart(
  actor: AssistantActor,
  task: AssistantTask,
  eventId: string,
): TaskRestartPlan {
  const seen = new Set<string>();
  const events = task.events.filter((event) => {
    if (seen.has(event.id)) return false;
    seen.add(event.id);
    return true;
  });
  const initial = events.find((event) => event.input)?.input;
  if (!initial || initial.owner?.id !== actor.id || !initial.taskId)
    throw new AssistantTaskError(
      "This task has no owned restart checkpoint.",
      409,
    );
  const parsed = assistantTaskSchema.safeParse(initial);
  if (!parsed.success)
    throw new AssistantTaskError(
      "This task's saved inputs cannot be restarted.",
      409,
    );
  const beginning = eventId === "beginning";
  let selectedIndex = beginning
    ? -1
    : events.findIndex((event) => event.id === eventId);
  const canonicalTerminal =
    selectedIndex < 0 &&
    projectTaskFlow(task).steps.some(
      (step) => step.id === eventId && step.origin === "run-status",
    );
  if (selectedIndex < 0 && !canonicalTerminal && !beginning)
    throw new AssistantTaskError("Recorded step not found.", 404);
  if (canonicalTerminal) selectedIndex = events.length;
  const selected = events[selectedIndex];
  const prefix = events.slice(0, selectedIndex + 1);
  const before = beginning ? [] : events.slice(0, selectedIndex);
  const source = prefix
    .toReversed()
    .find((event) => event.type !== "restart" && event.sources?.length)
    ?.sources?.[0];
  const sourceVersion =
    source?.version === "2"
      ? 2
      : source?.version === "1"
        ? 1
        : parsed.data.sourceVersion;
  const operation =
    canonicalTerminal && task.status !== "completed" ? events.at(-1) : selected;
  let phase: TaskRestartPhase = beginning ? "read" : phaseForEvent(operation);
  if (task.kind === "calendar_event") phase = "calendar_review";
  else if (task.mode === "calendar" && phase !== "review") phase = "read";
  // Rerunning read/preparation restores the state before that operation, not
  // the output produced by the selected operation itself.
  const preparationPrefix =
    phase === "read" || phase === "prepare" ? before : prefix;
  const brief = preparationPrefix
    .toReversed()
    .find((event) => event.type === "brief" && event.content?.trim());
  // Restored briefs are explicitly recorded in the trusted initial input, not
  // replayed as new model/fixture output in the replacement run.
  const prepared = brief?.content
    ? {
        content: brief.content,
        sources: brief.sources ?? [],
        key:
          task.mode === "rehearsal"
            ? rehearsalKey(brief.sources)
            : liveSourceKey(brief.sourceKey),
      }
    : prefix.some((event) => event.input === initial)
      ? initial.restart?.prepared
      : undefined;
  const restoredPrepared =
    prepared && task.mode === "calendar"
      ? { ...prepared, key: liveSourceKey(prepared.key) }
      : prepared;
  const delivered = before
    .toReversed()
    .find((event) => event.type === "notification");
  const inheritedPreviousKey = prefix.some((event) => event.input === initial)
    ? (initial.restart?.previousKey ?? "")
    : "";
  if (
    (phase === "review" || phase === "deliver") &&
    (!restoredPrepared || (task.mode === "calendar" && !restoredPrepared.key))
  )
    phase = "read";
  const restart: TaskRestartState = {
    version: 1,
    sourceRunId: task.runId,
    sourceEventId: beginning ? events[0].id : eventId,
    sourceTitle: beginning
      ? "Beginning of workflow"
      : (selected?.title ??
        projectTaskFlow(task).steps.find((step) => step.id === eventId)
          ?.label ??
        "Recorded terminal state"),
    phase,
    sourceVersion,
    previousKey:
      task.mode === "rehearsal"
        ? rehearsalKey(delivered?.sources) || inheritedPreviousKey
        : "",
    ...(restoredPrepared ? { prepared: restoredPrepared } : {}),
    ...(task.kind === "calendar_event"
      ? {
          calendarWriteActionId:
            initial.restart?.calendarWriteActionId ?? initial.taskId,
        }
      : {}),
  };
  let input = {
    ...parsed.data,
    manualStart: false,
    delaySeconds: 0,
    approvalRequired: true,
    sourceVersion,
    demoMode: task.mode === "rehearsal",
  };
  if (task.mode === "calendar" && task.kind === "meeting_prep" && source)
    input = { ...input, calendarEventId: input.calendarEventId ?? source.id };
  if (task.kind === "calendar_event") {
    try {
      input = {
        ...input,
        eventDraft: validateCalendarEventDraft(input.eventDraft),
      };
    } catch {
      throw new AssistantTaskError(
        "This exact calendar draft can no longer be restarted. Propose an event with future start and end times.",
        409,
      );
    }
  }
  return { input, restart };
}

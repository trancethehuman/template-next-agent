import { createHash, randomUUID } from "node:crypto";
import { getHookByToken, getRun, resumeHook, start } from "workflow/api";
import { HookNotFoundError, WorkflowRunNotFoundError } from "workflow/errors";
import { getWorld } from "workflow/runtime";
import { assistantTaskWorkflow } from "@/workflows/assistant-task";
import { assistantTaskSchema, projectAssistantTask } from "./task-policy";
import type {
  AssistantDemoStop,
  AssistantTask,
  TaskAction,
  TaskEvent,
  TaskRestartState,
} from "./types";
import { validateCalendarEventDraft } from "./calendar-event-schema";
import type { AssistantActor } from "@/lib/auth/actor";
import {
  assistantOwnerAttributes,
  assistantOwnerKey,
  isOwnedAssistantRun,
  listOwnedAssistantRuns,
} from "./ownership";
import { AssistantTaskError } from "./task-errors";
export { AssistantTaskError } from "./task-errors";

function taskWorkflowName(): string {
  const compiled = assistantTaskWorkflow as typeof assistantTaskWorkflow & {
    workflowId?: string;
  };
  return (
    compiled.workflowId ??
    "workflow//./workflows/assistant-task//assistantTaskWorkflow"
  );
}

export async function createAssistantTask(
  actor: AssistantActor,
  raw: unknown,
  options?: { idempotencyKey?: string; trustedRestart?: TaskRestartState },
): Promise<{ runId: string }> {
  assistantOwnerKey(actor);
  const parsed = assistantTaskSchema.safeParse(raw);
  if (!parsed.success) {
    const isCalendarDraft =
      raw !== null &&
      typeof raw === "object" &&
      "kind" in raw &&
      raw.kind === "calendar_event";
    throw new AssistantTaskError(
      isCalendarDraft
        ? "Provide an event title, valid time zone, and future start and end times with a duration of 5–480 minutes."
        : "Invalid task. Choose a mode, a delay up to 24 hours, and 1–5 checks.",
    );
  }
  let input = parsed.data;
  if (input.demoMode)
    input = {
      ...input,
      manualStart: false,
      delaySeconds: 0,
      approvalRequired: true,
    };
  if (input.kind === "calendar_event") {
    if (process.env.ASSISTANT_CALENDAR_WRITE_ENABLED !== "true")
      throw new AssistantTaskError(
        "Calendar event creation is disabled. Enable ASSISTANT_CALENDAR_WRITE_ENABLED before proposing an event.",
        403,
      );
    let eventDraft;
    try {
      eventDraft = validateCalendarEventDraft(input.eventDraft);
    } catch {
      throw new AssistantTaskError(
        "Provide an exact future event with a title, valid time zone, and duration between 5 and 480 minutes.",
      );
    }
    input = {
      ...input,
      eventDraft,
      mode: "calendar",
      approvalRequired: true,
      manualStart: false,
      delaySeconds: 0,
      maxChecks: 1,
      title: `Create calendar event: ${eventDraft.summary}`.slice(0, 120),
      prompt:
        "Create this exact calendar event only after you approve its details in the task inbox.",
    };
  }
  if (input.kind === "calendar_watch")
    // Read-only and messages only the owner, so it needs no approval gate.
    input = {
      ...input,
      mode: "calendar",
      approvalRequired: false,
      manualStart: false,
      delaySeconds: 0,
      demoMode: false,
      maxChecks: 5,
      title: "Watch my calendar",
      prompt: "Watch my calendar this week and tell me what needs a look.",
    };
  const taskId = createHash("sha256")
    .update(JSON.stringify([actor.id, options?.idempotencyKey ?? randomUUID()]))
    .digest("hex");
  const hookToken = `assistant-task:${actor.id}:${taskId}`;
  if (options?.idempotencyKey) {
    try {
      const existing = await getHookByToken(hookToken);
      if (existing) {
        await ownTaskRun(actor, existing.runId);
        return { runId: existing.runId };
      }
    } catch (error) {
      if (!HookNotFoundError.is(error)) throw error;
    }
  }
  const active = await Promise.all(
    ["pending", "running"].map((status) =>
      listOwnedAssistantRuns(actor, taskWorkflowName(), {
        status: status as "pending" | "running",
        limit: 21,
      }),
    ),
  );
  if (active.reduce((sum, page) => sum + page.length, 0) >= 20)
    throw new AssistantTaskError(
      "You already have 20 active tasks. Stop or finish one before starting another.",
      429,
    );
  const owner = { id: actor.id, email: actor.email };
  const run = await start(
    assistantTaskWorkflow,
    [
      {
        ...input,
        taskId,
        owner,
        ...(options?.trustedRestart ? { restart: options.trustedRestart } : {}),
      },
    ],
    { attributes: assistantOwnerAttributes(actor) },
  );
  if (options?.idempotencyKey) {
    // Concurrent deliveries can each create a run before either registers its
    // hook. Return the run that won the durable claim, rather than its duplicate.
    for (let attempt = 0; attempt < 20; attempt++) {
      try {
        const owner = await getHookByToken(hookToken);
        await ownTaskRun(actor, owner.runId);
        return { runId: owner.runId };
      } catch (error) {
        if (!HookNotFoundError.is(error)) throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
  return { runId: run.runId };
}

async function readTaskEvents(runId: string): Promise<TaskEvent[]> {
  const readable = getRun(runId).getReadable<string>();
  const tail = await readable.getTailIndex();
  if (tail < 0) {
    await readable.cancel();
    return [];
  }
  const reader = readable.getReader();
  const events: TaskEvent[] = [];
  try {
    for (let i = 0; i <= Math.min(tail, 999); i++) {
      const chunk = await reader.read();
      if (chunk.done) break;
      for (const line of chunk.value.split("\n").filter(Boolean)) {
        try {
          const value = JSON.parse(line) as TaskEvent;
          if (typeof value.id === "string" && typeof value.title === "string")
            events.push(value);
        } catch {
          /* Ignore an incomplete historical stream frame. */
        }
      }
    }
  } finally {
    await reader.cancel();
    reader.releaseLock();
  }
  return events;
}

async function ownTaskRun(actor: AssistantActor, runId: string) {
  if (!/^wrun_[A-Za-z0-9_-]{8,100}$/.test(runId))
    throw new AssistantTaskError("Task not found.", 404);
  const world = await getWorld();
  let metadata;
  try {
    metadata = await world.runs.get(runId, { resolveData: "none" });
  } catch (error) {
    if (WorkflowRunNotFoundError.is(error))
      throw new AssistantTaskError("Task not found.", 404);
    throw error;
  }
  if (
    metadata.workflowName !== taskWorkflowName() ||
    !isOwnedAssistantRun(actor, metadata)
  )
    throw new AssistantTaskError("Task not found.", 404);
  return getRun(runId);
}

export async function getAssistantTask(
  actor: AssistantActor,
  runId: string,
): Promise<AssistantTask> {
  const run = await ownTaskRun(actor, runId);
  const [status, createdAt, completedAt, events] = await Promise.all([
    run.status,
    run.createdAt,
    run.completedAt,
    readTaskEvents(runId),
  ]);
  return projectAssistantTask(
    { runId, status, createdAt, completedAt },
    events,
  );
}

/** A replacement is created first, so a failed start never destroys live work. */
export async function stopRehearsalAfterRestart(
  actor: AssistantActor,
  runId: string,
): Promise<boolean> {
  const run = await ownTaskRun(actor, runId);
  const task = await getAssistantTask(actor, runId);
  if (task.mode !== "rehearsal" || task.kind !== "meeting_prep")
    throw new AssistantTaskError(
      "Only a rehearsal can be stopped by a restart.",
      409,
    );
  if (task.status === "cancelled") return true;
  if (!["pending", "running"].includes(await run.status)) return false;
  await run.cancel({
    cancelReason: "Replaced by a new rehearsal from a recorded checkpoint.",
  });
  return true;
}

export async function listAssistantTasks(
  actor: AssistantActor,
): Promise<AssistantTask[]> {
  const pages = await Promise.all([
    listOwnedAssistantRuns(actor, taskWorkflowName(), {
      status: "pending",
      limit: 50,
    }),
    listOwnedAssistantRuns(actor, taskWorkflowName(), {
      status: "running",
      limit: 50,
    }),
    listOwnedAssistantRuns(actor, taskWorkflowName(), { limit: 30 }),
  ]);
  const runs = [
    ...new Map(
      pages.flatMap((page) => page).map((run) => [run.runId, run]),
    ).values(),
  ].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  const tasks = await Promise.all(
    runs.map(async (run) => {
      const events = await readTaskEvents(run.runId);
      // Conflict-only duplicate starts have no task event and never appear as new work.
      if (!events.length && run.status === "completed") return null;
      return projectAssistantTask(
        {
          runId: run.runId,
          status: run.status,
          createdAt: run.createdAt,
          completedAt: run.completedAt,
        },
        events,
      );
    }),
  );
  return tasks.filter((task): task is AssistantTask => task !== null);
}

export async function controlAssistantTask(
  actor: AssistantActor,
  runId: string,
  action: TaskAction,
  options?: {
    requestId?: string;
    expectedCheckpointId?: string;
    stopAt?: AssistantDemoStop;
  },
): Promise<{ runId: string; accepted: true }> {
  const run = await ownTaskRun(actor, runId);
  const task = await getAssistantTask(actor, runId);
  if (!task.allowedActions.includes(action))
    throw new AssistantTaskError(
      "That action is not available at the task's current checkpoint. Refresh its state and try again.",
      409,
    );
  if (
    (action !== "cancel" || task.kind === "calendar_event") &&
    (!options?.expectedCheckpointId ||
      options.expectedCheckpointId !== task.checkpointId)
  )
    throw new AssistantTaskError(
      "The task checkpoint changed. Review the current state before taking this action.",
      409,
    );
  if (action === "cancel" && task.kind !== "calendar_event") {
    await run.cancel({ cancelReason: "Stopped by the workspace owner." });
    return { runId, accepted: true };
  }
  const initialSleep =
    task.events.filter((event) => event.status).at(-1)?.title ===
    "Scheduled wake-up";
  if (initialSleep) {
    if (action !== "wake")
      throw new AssistantTaskError(
        "This task is waiting for its scheduled start. Wake it now or stop it.",
        409,
      );
    await run.wakeUp();
    return { runId, accepted: true };
  }
  const input = task.events.find((event) => event.input)?.input;
  if (!input)
    throw new AssistantTaskError(
      "The workflow is registering its first checkpoint. Try again in a moment.",
      409,
    );
  try {
    await resumeHook(`assistant-task:${actor.id}:${input.taskId}`, {
      action,
      requestId: options?.requestId ?? randomUUID(),
      checkpointId: options?.expectedCheckpointId,
      ...(action === "play" && options?.stopAt ? { stopAt: options.stopAt } : {}),
    });
  } catch {
    throw new AssistantTaskError(
      "The workflow checkpoint changed. Refresh the task before retrying.",
      409,
    );
  }
  return { runId, accepted: true };
}

import { createHash } from "node:crypto";
import type { AssistantActor } from "@/lib/auth/actor";
import { AssistantTaskError } from "./task-errors";
import {
  createAssistantTask,
  getAssistantTask,
  stopRehearsalAfterRestart,
} from "./tasks";
import { planAssistantTaskRestart, taskRestartSchema } from "./restart-plan";
export { planAssistantTaskRestart, taskRestartSchema } from "./restart-plan";
export type { TaskRestartPlan } from "./restart-plan";

export async function restartAssistantTask(
  actor: AssistantActor,
  runId: string,
  raw: unknown,
): Promise<{ runId: string; parentStopped: boolean; notice?: string }> {
  const request = taskRestartSchema.safeParse(raw);
  if (!request.success)
    throw new AssistantTaskError(
      "Choose a recorded step and a valid restart request.",
    );
  // This verifies World ownership before opening any persisted task stream.
  const parent = await getAssistantTask(actor, runId);
  const plan = planAssistantTaskRestart(actor, parent, request.data.eventId);
  const key = createHash("sha256")
    .update(
      JSON.stringify([runId, request.data.eventId, request.data.requestId]),
    )
    .digest("hex");
  const run = await createAssistantTask(actor, plan.input, {
    idempotencyKey: `restart:${key}`,
    trustedRestart: plan.restart,
  });
  if (parent.mode === "rehearsal" && parent.kind === "meeting_prep") {
    try {
      return {
        ...run,
        parentStopped: await stopRehearsalAfterRestart(actor, runId),
      };
    } catch {
      return {
        ...run,
        parentStopped: false,
        notice:
          "The new run was created, but the previous rehearsal could not be stopped. Stop the previous run from its inbox row.",
      };
    }
  }
  return {
    ...run,
    parentStopped: false,
    ...(["pending", "running"].includes(parent.workflowStatus)
      ? {
          notice:
            "The original live run is still active. Restart created a separate run; an in-flight calendar request cannot be recalled. Calendar writes require a fresh owner approval and retain the original event identity.",
        }
      : {}),
  };
}

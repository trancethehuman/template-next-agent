import { createHash } from "node:crypto";
import { getWorld } from "workflow/runtime";
import type {
  WorkflowRunStatus,
  WorkflowRunWithoutData,
} from "@workflow/world";
import type { AssistantActor } from "@/lib/auth/actor";
import { AssistantTaskError } from "./task-errors";

export const ASSISTANT_OWNER_ATTRIBUTE = "assistantOwner";

export function assistantOwnerKey(actor: AssistantActor): string {
  if (!actor?.id?.startsWith("google:") || !actor.email)
    throw new AssistantTaskError(
      "Sign in with your Google account.",
      401,
    );
  return createHash("sha256").update(actor.id).digest("hex");
}

export function assistantOwnerAttributes(actor: AssistantActor) {
  return { [ASSISTANT_OWNER_ATTRIBUTE]: assistantOwnerKey(actor) };
}

export function isOwnedAssistantRun(
  actor: AssistantActor,
  run: Pick<WorkflowRunWithoutData, "attributes">,
): boolean {
  // No legacy fallback: an unowned run can never be claimed by the first login.
  return (
    run.attributes?.[ASSISTANT_OWNER_ATTRIBUTE] === assistantOwnerKey(actor)
  );
}

/** Operational listings have no attribute filter in the pinned World SDK. */
export async function listOwnedAssistantRuns(
  actor: AssistantActor,
  workflowName: string,
  options: { status?: WorkflowRunStatus; limit: number },
): Promise<WorkflowRunWithoutData[]> {
  assistantOwnerKey(actor);
  const world = await getWorld();
  const owned: WorkflowRunWithoutData[] = [];
  let cursor: string | undefined;
  for (let pageIndex = 0; pageIndex < 100; pageIndex++) {
    const page = await world.runs.list({
      workflowName,
      status: options.status,
      resolveData: "none",
      pagination: { cursor, limit: 100, sortOrder: "desc" },
    });
    for (const run of page.data) {
      if (!isOwnedAssistantRun(actor, run)) continue;
      owned.push(run);
      if (owned.length >= options.limit) return owned;
    }
    if (!page.hasMore) return owned;
    if (!page.cursor || page.cursor === cursor) break;
    cursor = page.cursor;
  }
  // An incomplete scan must not look like an empty inbox or a free task quota.
  throw new AssistantTaskError(
    "Your task index could not be fully checked. Try again shortly.",
    503,
  );
}

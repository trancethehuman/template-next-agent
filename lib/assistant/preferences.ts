import { getRun, start } from "workflow/api";
import { assistantPreferenceWorkflow } from "@/workflows/assistant-task";
import {
  assistantPreferenceSchema,
  defaultAssistantPreference,
} from "./task-policy";
import { AssistantTaskError } from "./tasks";
import type { AssistantPreference } from "./types";
import type { AssistantActor } from "@/lib/auth/actor";
import { assistantOwnerAttributes, listOwnedAssistantRuns } from "./ownership";

function preferenceWorkflowName() {
  return (
    (
      assistantPreferenceWorkflow as typeof assistantPreferenceWorkflow & {
        workflowId?: string;
      }
    ).workflowId ??
    "workflow//./workflows/assistant-task//assistantPreferenceWorkflow"
  );
}

export async function getAssistantPreference(actor: AssistantActor) {
  const runs = await listOwnedAssistantRuns(actor, preferenceWorkflowName(), {
    status: "completed",
    limit: 1,
  });
  const latest = runs[0];
  if (!latest)
    return {
      preference: defaultAssistantPreference,
      source: "default" as const,
      updatedAt: null,
      runId: null,
    };
  const value = await getRun<
    AssistantPreference & { reset: boolean; owner: AssistantActor }
  >(latest.runId).returnValue;
  if (value.owner?.id !== actor.id)
    throw new AssistantTaskError("Preference not found.", 404);
  return {
    preference: {
      bulletCount: value.bulletCount,
      includeLinks: value.includeLinks,
    },
    source: value.reset ? ("reset" as const) : ("owner" as const),
    updatedAt: latest.createdAt.toISOString(),
    runId: latest.runId,
  };
}

export async function saveAssistantPreference(
  actor: AssistantActor,
  raw: unknown,
  reset = false,
) {
  const parsed = assistantPreferenceSchema.safeParse(
    reset ? defaultAssistantPreference : raw,
  );
  if (!parsed.success)
    throw new AssistantTaskError(
      "Choose three or five bullets and whether to include source links.",
    );
  const run = await start(
    assistantPreferenceWorkflow,
    [{ ...parsed.data, reset, owner: { id: actor.id, email: actor.email } }],
    { attributes: assistantOwnerAttributes(actor) },
  );
  await run.returnValue;
  return { preference: parsed.data, runId: run.runId };
}

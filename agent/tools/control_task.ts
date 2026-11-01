import { defineTool } from "eve/tools";
import { z } from "zod";
import { AssistantBackendError, requestTaskBackend } from "../lib/task-backend";
import type { AssistantTask } from "../../lib/assistant/types";
import { requireAssistantContextActor } from "../lib/auth";

export default defineTool({
  description: "Change an assistant task only when the owner asks. Start queued work, pause/resume at a checkpoint, wake a durable wait, finish monitoring, or cancel permanently. Rehearsal replay/update-source simulate a source trigger. Approving a brief requires the owner's inbox action; this tool cannot approve its own output.",
  inputSchema: z.object({
    runId: z.string().regex(/^wrun_[A-Za-z0-9_-]{8,100}$/),
    action: z.enum(["start", "wake", "pause", "resume", "cancel", "finish", "replay", "update-source"]),
  }),
  async execute({ runId, action }, ctx) {
    const actor = requireAssistantContextActor(ctx);
    try {
      const { task } = await requestTaskBackend<{task: AssistantTask}>(actor, `/api/assistant/tasks/${runId}`);
      return await requestTaskBackend<{runId: string; accepted: true}>(actor, `/api/assistant/tasks/${runId}`, {
        method: "POST", body: {
          action,
          requestId: `${ctx.session.id}:${ctx.callId}`,
          expectedCheckpointId: task.checkpointId,
        },
      });
    } catch (error) {
      if (error instanceof AssistantBackendError) return { error: error.message };
      return { error: "The task control could not be accepted. Refresh its inbox entry before retrying." };
    }
  },
});

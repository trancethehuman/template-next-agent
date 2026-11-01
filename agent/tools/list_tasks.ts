import { defineTool } from "eve/tools";
import { z } from "zod";
import type { AssistantTask } from "../../lib/assistant/types";
import { requestTaskBackend } from "../lib/task-backend";
import { requireAssistantContextActor } from "../lib/auth";

export default defineTool({
  description: "Read the signed-in user's recent assistant tasks and actual durable state. Other users' tasks and other workflow types are excluded.",
  inputSchema: z.object({}),
  async execute(_input, ctx) {
    const actor = requireAssistantContextActor(ctx);
    const { tasks } = await requestTaskBackend<{tasks: AssistantTask[]}>(actor, "/api/assistant/tasks");
    return { tasks: tasks.map(task => ({
      runId: task.runId,
      title: task.title,
      mode: task.mode,
      kind: task.kind,
      status: task.status,
      notificationCount: task.notificationCount,
      allowedActions: task.allowedActions,
    })) };
  },
});

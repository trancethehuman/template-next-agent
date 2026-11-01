import { defineTool } from "eve/tools";
import { z } from "zod";
import type { AssistantTask } from "../../lib/assistant/types";
import { AssistantBackendError, requestTaskBackend } from "../lib/task-backend";
import { requireAssistantContextActor } from "../lib/auth";

export default defineTool({
  description: "Inspect an existing assistant task's actual Workflow state, brief, exact Calendar event draft, confirmed Google event ID/link when created, and recent activity. A task ID must come from a real tool result or the user. Only a completed calendar_event task with its returned calendarEvent confirms creation; task acceptance or approval alone does not.",
  inputSchema: z.object({ runId: z.string().regex(/^wrun_[A-Za-z0-9_-]{8,100}$/) }),
  async execute({ runId }, ctx) {
    const actor = requireAssistantContextActor(ctx);
    try {
      const { task } = await requestTaskBackend<{task: AssistantTask}>(actor, `/api/assistant/tasks/${runId}`);
      return {
        runId: task.runId,
        title: task.title,
        mode: task.mode,
        kind: task.kind,
        status: task.status,
        brief: task.brief,
        error: task.error,
        notificationCount: task.notificationCount,
        allowedActions: task.allowedActions,
        checkpointId: task.checkpointId,
        eventDraft: task.eventDraft,
        calendarEvent: task.calendarEvent,
        calendarCreationConfirmed: task.kind === "calendar_event"
          && task.status === "completed" && Boolean(task.calendarEvent?.id),
        activity: task.events.slice(-12).map(({ title, detail, type, sources }) => ({ title, detail, type, sources })),
      };
    } catch (error) {
      if (error instanceof AssistantBackendError) return { error: error.message };
      return { error: "The task state could not be read. Retry from the task inbox." };
    }
  },
});

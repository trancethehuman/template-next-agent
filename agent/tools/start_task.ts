import { defineTool } from "eve/tools";
import { z } from "zod";
import { getCalendarStatus } from "../../lib/assistant/calendar";
import { assistantPreference } from "../lib/preference";
import { requestTaskBackend } from "../lib/task-backend";
import { requireAssistantContextActor } from "../lib/auth";
import { isAssistantModel } from "../../lib/assistant/models";

export default defineTool({
  description: "Start a bounded meeting-prep Workflow that appears in the task inbox and continues without the browser. Calendar mode reads real Calendar facts and uses the model to prepare the requested brief; rehearsal mode uses clearly labeled deterministic fictional fixtures and requires the user to request a rehearsal. For a particular meeting, first read_calendar and pass its event ID and time window. This does not perform arbitrary tasks or send messages. Delivery always pauses for the owner's review in the inbox.",
  inputSchema: z.object({
    title: z.string().trim().min(1).max(120),
    prompt: z.string().trim().min(1).max(2000),
    mode: z.enum(["calendar", "rehearsal"]),
    delaySeconds: z.number().int().min(0).max(86400).default(0),
    maxChecks: z.number().int().min(1).max(5).default(3),
    manualStart: z.boolean().default(false),
    calendarEventId: z.string().min(1).max(512).optional(),
    timeMin: z.iso.datetime({ offset: true }).optional(),
    timeMax: z.iso.datetime({ offset: true }).optional(),
  }),
  async execute(input, ctx) {
    const actor = requireAssistantContextActor(ctx);
    if (input.mode === "calendar") {
      const calendar = await getCalendarStatus(actor);
      if (calendar.state !== "connected")
        return { started: false, error: calendar.state, message: calendar.message };
    }
    const preference = assistantPreference.get();
    const task = await requestTaskBackend<{runId: string}>(actor, "/api/assistant/tasks", { method: "POST", body: {
      ...input,
      // Briefs use the same model the caller chose for this chat.
      ...(isAssistantModel(ctx.session.auth.current?.attributes.model)
        ? { model: ctx.session.auth.current.attributes.model }
        : {}),
      approvalRequired: true,
      preference: preference
        ? { bulletCount: preference.bulletCount, includeLinks: preference.includeSources }
        : { bulletCount: 3, includeLinks: true },
    }, idempotencyKey: `${ctx.session.id}:${ctx.callId}` });
    return { started: true, runId: task.runId, mode: input.mode, destination: "/assistant", message: "Task accepted. Open its inbox entry to inspect actual progress and review the brief before delivery." };
  },
});

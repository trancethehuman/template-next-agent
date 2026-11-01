import { defineTool } from "eve/tools";
import { z } from "zod";
import { requireAssistantContextActor } from "../lib/auth";
import {
  CalendarIntegrationError,
  listCalendarEvents,
} from "../../lib/assistant/calendar";

export default defineTool({
  description: "Read upcoming events from the signed-in user's connected primary Google Calendar. Account identity comes only from verified runtime authentication. This is a live read-only integration, never synthetic. Returns source event IDs, URLs and calendar timezone. Dates must include an offset. No connection returns a setup error.",
  inputSchema: z.object({
    timeMin: z.iso.datetime({ offset: true }).optional(),
    timeMax: z.iso.datetime({ offset: true }).optional(),
    limit: z.number().int().min(1).max(20).default(10),
  }),
  async execute(input, ctx) {
    const actor = requireAssistantContextActor(ctx);
    try {
      return { mode: "calendar", ...(await listCalendarEvents(actor, input)) };
    } catch (error) {
      if (error instanceof CalendarIntegrationError)
        return { error: error.code, message: error.message };
      return { error: "unavailable", message: "Google Calendar could not be read. Retry from the calendar panel." };
    }
  },
});

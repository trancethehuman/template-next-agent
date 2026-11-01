import { defineTool } from "eve/tools";
import { z } from "zod";
import { requireAssistantContextActor } from "../lib/auth";
import {
  CalendarIntegrationError,
  findCalendarAvailability,
} from "../../lib/assistant/calendar";

export default defineTool({
  description: "Read Google Calendar free/busy data and find available slots inside the user's requested time window. Does not book or change events. All timestamps must include an offset.",
  inputSchema: z.object({
    timeMin: z.iso.datetime({ offset: true }),
    timeMax: z.iso.datetime({ offset: true }),
    durationMinutes: z.number().int().min(5).max(480),
    timeZone: z.string().trim().min(1).max(100).optional(),
  }),
  async execute(input, ctx) {
    const actor = requireAssistantContextActor(ctx);
    try {
      return await findCalendarAvailability(actor, input);
    } catch (error) {
      if (error instanceof CalendarIntegrationError)
        return { error: error.code, message: error.message };
      return { error: "unavailable", message: "Calendar availability could not be read. Retry from the calendar panel." };
    }
  },
});

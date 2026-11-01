import { defineTool } from "eve/tools";
import { calendarEventDraftSchema } from "../../lib/assistant/calendar-event-schema";
import { proposeCalendarEvent } from "../lib/calendar-proposal";
import { requireAssistantContextActor } from "../lib/auth";

export default defineTool({
  description: "Propose one private Google Calendar event after the owner asks to add it. Requires exact title, future start/end timestamps with explicit offsets, and IANA timezone; optional description only. Check calendar/free-busy and clarify ambiguous times first. This tool checks availability and queues the exact immutable draft in the task inbox; it NEVER writes Google Calendar. Only the owner's separate inbox approval can create the event. No attendees, invitations, conference, calendar-ID override, update or delete.",
  inputSchema: calendarEventDraftSchema,
  execute(input, ctx) {
    return proposeCalendarEvent(requireAssistantContextActor(ctx), input, `${ctx.session.id}:${ctx.callId}`);
  },
});

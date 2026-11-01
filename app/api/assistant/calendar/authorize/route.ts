import { requireAssistantActor } from "@/lib/auth/request";
import { calendarErrorStatus, createCalendarAuthorizationUrl } from "@/lib/assistant/calendar";
import { calendarAuthorizationCallback } from "@/lib/assistant/calendar-callback";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  const actor = await requireAssistantActor(request);
  if (actor instanceof Response) return actor;
  try {
    const callbackUrl = calendarAuthorizationCallback(request);
    return Response.json({url: await createCalendarAuthorizationUrl(actor, callbackUrl)}, {headers: {"Cache-Control": "no-store"}});
  } catch (error) {
    const status = calendarErrorStatus(error);
    return Response.json({error: status.message, status}, {status: 503, headers: {"Cache-Control": "no-store"}});
  }
}

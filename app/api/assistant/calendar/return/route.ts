import { calendarReturnDestination } from "@/lib/assistant/calendar-callback";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** This route redirects local OAuth return traffic; it cannot read calendar data. */
export async function GET(request: Request): Promise<Response> {
  try {
    return new Response(null, {status: 307, headers: {Location: calendarReturnDestination(request), "Cache-Control": "no-store"}});
  } catch {
    return Response.json({error: "Invalid local calendar return."}, {status: 400, headers: {"Cache-Control": "no-store"}});
  }
}

import { requireAssistantActor } from "@/lib/auth/request";
import { getCalendarOverview } from "@/lib/assistant/calendar";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  const actor = await requireAssistantActor(request);
  if (actor instanceof Response) return actor;
  return Response.json(await getCalendarOverview(actor), { headers: { "Cache-Control": "no-store" } });
}

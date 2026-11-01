import { getRun } from "workflow/api";
import { requireAssistantActor } from "@/lib/auth/request";
import { getAssistantTask, AssistantTaskError } from "@/lib/assistant/tasks";
import { assistantError } from "@/lib/assistant/task-http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ runId: string }> },
) {
  const actor = await requireAssistantActor(request);
  if (actor instanceof Response) return actor;
  try {
    const { runId } = await params;
    await getAssistantTask(actor, runId);
    const value = new URL(request.url).searchParams.get("startIndex") ?? "0";
    if (!/^\d{1,6}$/.test(value))
      throw new AssistantTaskError("Invalid stream cursor.");
    const stream = getRun(runId).getReadable<string>({
      startIndex: Number(value),
    });
    return new Response(stream.pipeThrough(new TextEncoderStream()), {
      headers: {
        "Content-Type": "application/x-ndjson",
        "Cache-Control": "no-store",
        "X-Accel-Buffering": "no",
      },
    });
  } catch (error) {
    return assistantError(error);
  }
}

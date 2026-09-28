import { getRun } from "workflow/api";
import { authorizeDemoRequest } from "@/lib/classification/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(
  request: Request,
  { params }: { params: Promise<{ runId: string }> },
): Promise<Response> {
  const denied = authorizeDemoRequest(request);
  if (denied) return denied;
  const { runId } = await params;
  if (!/^[A-Za-z0-9_-]{1,150}$/.test(runId)) {
    return Response.json({ error: "Invalid run ID." }, { status: 400 });
  }
  const indexText = new URL(request.url).searchParams.get("startIndex");
  const startIndex = indexText === null ? 0 : Number(indexText);
  if (!Number.isSafeInteger(startIndex) || startIndex < 0) {
    return Response.json({ error: "Invalid stream position." }, { status: 400 });
  }
  try {
    const run = getRun(runId);
    if (!(await run.exists)) return Response.json({ error: "Run not found." }, { status: 404 });
    const encoder = new TextEncoder();
    const stream = run.getReadable<string>({ startIndex }).pipeThrough(
      new TransformStream<string, Uint8Array>({
        transform(chunk, controller) {
          controller.enqueue(encoder.encode(chunk));
        },
      }),
    );
    return new Response(stream, {
      headers: {
        "Content-Type": "application/x-ndjson; charset=utf-8",
        "Cache-Control": "no-store, no-transform",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch {
    return Response.json({ error: "Classification stream is unavailable." }, { status: 503 });
  }
}

import { start } from "workflow/api";
import { authorizeDemoRequest } from "@/lib/classification/auth";
import { runInputSchema } from "@/lib/classification/input";
import { classifyTransactionsWorkflow } from "@/workflows/classify-transactions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BODY_BYTES = 64 * 1024;

async function readBody(request: Request): Promise<string | null> {
  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) return null;
  const reader = request.body?.getReader();
  if (!reader) return null;
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_BODY_BYTES) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

export async function POST(request: Request): Promise<Response> {
  const denied = authorizeDemoRequest(request);
  if (denied) return denied;
  let body: unknown;
  try {
    const text = await readBody(request);
    if (!text) return Response.json({ error: "Invalid transaction request." }, { status: 400 });
    body = JSON.parse(text);
  } catch {
    return Response.json({ error: "Invalid transaction request." }, { status: 400 });
  }
  const input = runInputSchema.safeParse(body);
  if (!input.success) return Response.json({ error: "Invalid transaction request." }, { status: 400 });
  try {
    const run = await start(classifyTransactionsWorkflow, [input.data.transactions]);
    return Response.json({ runId: run.runId }, { status: 202, headers: { "Cache-Control": "no-store" } });
  } catch {
    return Response.json({ error: "Unable to start classification." }, { status: 503 });
  }
}

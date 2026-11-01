import { AssistantTaskError } from "./task-errors";

export function assistantJson(value: unknown, status = 200) {
  return Response.json(value, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

export async function assistantRequestBody(request: Request): Promise<unknown> {
  const limit = 8 * 1024;
  if (Number(request.headers.get("content-length")) > limit)
    throw new AssistantTaskError("Task request is too large.", 413);
  const reader = request.body?.getReader();
  if (!reader) throw new AssistantTaskError("A JSON task request is required.");
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const next = await reader.read();
    if (next.done) break;
    total += next.value.byteLength;
    if (total > limit) {
      await reader.cancel();
      throw new AssistantTaskError("Task request is too large.", 413);
    }
    chunks.push(next.value);
  }
  const bytes = new Uint8Array(total);
  let position = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, position);
    position += chunk.byteLength;
  }
  try {
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new AssistantTaskError("A valid JSON task request is required.");
  }
}

export function assistantError(error: unknown) {
  return error instanceof AssistantTaskError
    ? assistantJson({ error: error.message }, error.status)
    : assistantJson(
        {
          error: "The durable task service is unavailable. Try again shortly.",
        },
        503,
      );
}

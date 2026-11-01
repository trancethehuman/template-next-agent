import { requireAssistantActor } from "@/lib/auth/request";
import {
  AssistantTaskError,
  createAssistantTask,
  listAssistantTasks,
} from "@/lib/assistant/tasks";
import { assistantModelFromCookie } from "@/lib/assistant/models";
import {
  assistantError,
  assistantJson,
  assistantRequestBody,
} from "@/lib/assistant/task-http";

/** A browser request without an explicit model uses the one chosen in the chat. */
function withChosenModel(body: unknown, model: string | undefined): unknown {
  if (!model || !body || typeof body !== "object" || Array.isArray(body) || "model" in body)
    return body;
  return { ...body, model };
}

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const actor = await requireAssistantActor(request);
  if (actor instanceof Response) return actor;
  try {
    return assistantJson({ tasks: await listAssistantTasks(actor) });
  } catch (error) {
    return assistantError(error);
  }
}

export async function POST(request: Request) {
  const actor = await requireAssistantActor(request);
  if (actor instanceof Response) return actor;
  try {
    const idempotencyKey =
      request.headers.get("x-assistant-idempotency-key") ?? undefined;
    if (idempotencyKey && !/^[A-Za-z0-9:_-]{8,200}$/.test(idempotencyKey))
      throw new AssistantTaskError("Invalid task request key.");
    return assistantJson(
      await createAssistantTask(
        actor,
        withChosenModel(
          await assistantRequestBody(request),
          assistantModelFromCookie(request.headers.get("cookie")),
        ),
        { idempotencyKey },
      ),
      202,
    );
  } catch (error) {
    return assistantError(error);
  }
}

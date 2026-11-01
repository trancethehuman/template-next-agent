import { requireAssistantActor } from "@/lib/auth/request";
import { restartAssistantTask } from "@/lib/assistant/restart";
import {
  assistantError,
  assistantJson,
  assistantRequestBody,
} from "@/lib/assistant/task-http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Context = { params: Promise<{ runId: string }> };

export async function POST(request: Request, { params }: Context) {
  const actor = await requireAssistantActor(request, { allowService: false });
  if (actor instanceof Response) return actor;
  try {
    return assistantJson(
      await restartAssistantTask(
        actor,
        (await params).runId,
        await assistantRequestBody(request),
      ),
      202,
    );
  } catch (error) {
    return assistantError(error);
  }
}

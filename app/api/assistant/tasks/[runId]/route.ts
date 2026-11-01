import { requireAssistantActor } from "@/lib/auth/request";
import {
  controlAssistantTask,
  getAssistantTask,
  AssistantTaskError,
} from "@/lib/assistant/tasks";
import { taskActionSchema } from "@/lib/assistant/task-policy";
import {
  assistantError,
  assistantJson,
  assistantRequestBody,
} from "@/lib/assistant/task-http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Context = { params: Promise<{ runId: string }> };

export async function GET(request: Request, { params }: Context) {
  const actor = await requireAssistantActor(request);
  if (actor instanceof Response) return actor;
  try {
    return assistantJson({
      task: await getAssistantTask(actor, (await params).runId),
    });
  } catch (error) {
    return assistantError(error);
  }
}

export async function POST(request: Request, { params }: Context) {
  const actor = await requireAssistantActor(request);
  if (actor instanceof Response) return actor;
  try {
    const input = taskActionSchema.safeParse(
      await assistantRequestBody(request),
    );
    if (!input.success)
      throw new AssistantTaskError("Choose a valid task action.");
    let controlActor = actor;
    if (["approve", "deny", "advance", "play"].includes(input.data.action)) {
      const browserActor = await requireAssistantActor(request, {
        allowService: false,
      });
      if (browserActor instanceof Response) return browserActor;
      if (browserActor.id !== actor.id)
        return assistantJson(
          { error: "This control must come from the signed-in task owner." },
          403,
        );
      controlActor = browserActor;
    }
    return assistantJson(
      await controlAssistantTask(
        controlActor,
        (await params).runId,
        input.data.action,
        {
          requestId: input.data.requestId,
          expectedCheckpointId: input.data.expectedCheckpointId,
          stopAt: input.data.stopAt,
        },
      ),
      202,
    );
  } catch (error) {
    return assistantError(error);
  }
}

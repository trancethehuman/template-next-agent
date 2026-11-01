import { requireAssistantActor } from "@/lib/auth/request";
import {
  getAssistantPreference,
  saveAssistantPreference,
} from "@/lib/assistant/preferences";
import {
  assistantError,
  assistantJson,
  assistantRequestBody,
} from "@/lib/assistant/task-http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  const actor = await requireAssistantActor(request);
  if (actor instanceof Response) return actor;
  try {
    return assistantJson(await getAssistantPreference(actor));
  } catch (error) {
    return assistantError(error);
  }
}
export async function PUT(request: Request) {
  const actor = await requireAssistantActor(request);
  if (actor instanceof Response) return actor;
  try {
    return assistantJson(
      await saveAssistantPreference(actor, await assistantRequestBody(request)),
    );
  } catch (error) {
    return assistantError(error);
  }
}
export async function DELETE(request: Request) {
  const actor = await requireAssistantActor(request);
  if (actor instanceof Response) return actor;
  try {
    return assistantJson(await saveAssistantPreference(actor, null, true));
  } catch (error) {
    return assistantError(error);
  }
}

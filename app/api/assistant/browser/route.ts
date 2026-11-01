import { requireAssistantActor } from "@/lib/auth/request";
import {
  BrowserError,
  browserStatus,
  keepBrowserAwake,
  openBrowser,
  stopBrowser,
} from "@/lib/assistant/browser";
import { assistantJson } from "@/lib/assistant/task-http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// The first start for an account installs Chrome, which takes about a minute.
export const maxDuration = 300;

function browserFailure(error: unknown) {
  return assistantJson(
    { error: error instanceof BrowserError ? error.message : "The cloud browser is unavailable. Try again shortly." },
    503,
  );
}

/** The signed-in user's own cloud browser. Reading status never starts or wakes it. */
export async function GET(request: Request) {
  const actor = await requireAssistantActor(request, { allowService: false });
  if (actor instanceof Response) return actor;
  try {
    return assistantJson(await browserStatus(actor));
  } catch (error) {
    return browserFailure(error);
  }
}

/**
 * `open` starts the browser, or resumes it from its saved disk. `keepalive` is
 * the owner's Keep awake: a running browser gets a full idle window from now.
 * The page never sends it on its own, so an open tab cannot keep it running.
 */
export async function POST(request: Request) {
  const actor = await requireAssistantActor(request, { allowService: false });
  if (actor instanceof Response) return actor;
  let action: unknown;
  try {
    action = ((await request.json()) as { action?: unknown }).action;
  } catch {
    action = undefined;
  }
  if (action !== "open" && action !== "keepalive")
    return assistantJson({ error: "Choose open or keepalive." }, 400);
  try {
    if (action === "open") await openBrowser(actor);
    else await keepBrowserAwake(actor);
    return assistantJson(await browserStatus(actor));
  } catch (error) {
    return browserFailure(error);
  }
}

/** Saves the open tabs, closes Chrome cleanly, and stops the browser. Everything resumes next time. */
export async function DELETE(request: Request) {
  const actor = await requireAssistantActor(request, { allowService: false });
  if (actor instanceof Response) return actor;
  try {
    await stopBrowser(actor);
    return assistantJson(await browserStatus(actor));
  } catch (error) {
    return browserFailure(error);
  }
}

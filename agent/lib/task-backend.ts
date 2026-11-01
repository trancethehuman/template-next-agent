import { isAssistantTeamActor, parseAssistantActor } from "../../lib/auth/actor";
import type { AssistantActor } from "../../lib/auth/actor";
import { signAssistantServiceToken } from "../../lib/auth/request";

type BackendEnvironment = {
  ASSISTANT_APP_ORIGIN?: string;
  EVE_DEV?: string;
  NODE_ENV?: string;
  VERCEL_URL?: string;
  VERCEL_OIDC_TOKEN?: string;
  VERCEL_AUTOMATION_BYPASS_SECRET?: string;
};

type BackendFetch = (url: string, init: RequestInit) => Promise<Response>;

export class AssistantBackendError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AssistantBackendError";
  }
}

/** Task Workflows belong to Next's World/queue, separately from EVE sessions. */
export function assistantBackendOrigin(environment: BackendEnvironment): string {
  const local = environment.EVE_DEV === "1" || environment.NODE_ENV === "development";
  const configured = environment.ASSISTANT_APP_ORIGIN?.trim()
    || (environment.VERCEL_URL ? `https://${environment.VERCEL_URL}` : undefined)
    || (local ? "http://127.0.0.1:3000" : undefined);
  if (!configured)
    throw new AssistantBackendError("Set ASSISTANT_APP_ORIGIN to the Next.js app's origin so the agent can reach its task inbox.");
  let url: URL;
  try { url = new URL(configured); } catch {
    throw new AssistantBackendError("ASSISTANT_APP_ORIGIN must be a valid application origin.");
  }
  const loopback = ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname);
  if ((url.protocol !== "https:" && !(local && loopback && url.protocol === "http:"))
    || url.username || url.password || url.pathname !== "/" || url.search || url.hash)
    throw new AssistantBackendError("ASSISTANT_APP_ORIGIN must be an HTTPS origin, or a loopback HTTP origin during development.");
  return url.origin;
}

export function createTaskBackend(
  environment: () => BackendEnvironment = () => process.env,
  requestFetch: BackendFetch = fetch,
  signToken: typeof signAssistantServiceToken = signAssistantServiceToken,
) {
  return async function requestTaskBackend<T>(
    actor: AssistantActor,
    path: string,
    options: { method?: "GET" | "POST"; body?: unknown; idempotencyKey?: string } = {},
  ): Promise<T> {
    // This path is authored by tools, never a model-supplied URL.
    if (!/^\/api\/assistant\/tasks(?:\/wrun_[A-Za-z0-9_-]{8,100})?$/.test(path))
      throw new AssistantBackendError("Invalid assistant task endpoint.");
    const env = environment();
    const origin = assistantBackendOrigin(env);
    if (!parseAssistantActor(actor) || !isAssistantTeamActor(actor))
      throw new AssistantBackendError("A verified Google account permitted by this application's sign-in policy is required for task work.");
    let serviceToken: string;
    try { serviceToken = await signToken(actor); }
    catch { throw new AssistantBackendError("Assistant service authentication is not configured. Set AUTH_SECRET consistently on both application services."); }
    const headers = new Headers({ Accept: "application/json" });
    headers.set("Authorization", `Bearer ${serviceToken}`);
    if (env.VERCEL_OIDC_TOKEN) headers.set("x-vercel-trusted-oidc-idp-token", env.VERCEL_OIDC_TOKEN);
    if (env.VERCEL_AUTOMATION_BYPASS_SECRET) headers.set("x-vercel-protection-bypass", env.VERCEL_AUTOMATION_BYPASS_SECRET);
    if (options.body !== undefined) headers.set("Content-Type", "application/json");
    if (options.idempotencyKey) headers.set("x-assistant-idempotency-key", options.idempotencyKey);
    let response: Response;
    try {
      response = await requestFetch(`${origin}${path}`, {
        method: options.method ?? "GET",
        headers,
        body: options.body === undefined ? undefined : JSON.stringify(options.body),
        redirect: "error",
        cache: "no-store",
        signal: AbortSignal.timeout(30_000),
      });
    } catch {
      throw new AssistantBackendError("The task service could not be reached. Check ASSISTANT_APP_ORIGIN and inspect the task inbox before retrying.");
    }
    let body: unknown;
    try { body = await response.json(); } catch {
      throw new AssistantBackendError("The task service did not return JSON. Check its deployment protection and app origin.");
    }
    if (!response.ok) {
      if (response.status === 401 || response.status === 403)
        throw new AssistantBackendError("The task service denied access. Sign in again and check AUTH_SECRET and deployment protection on both services.");
      const message = body && typeof body === "object" && "error" in body
        && typeof body.error === "string" ? body.error.slice(0, 400) : "The task service could not complete the request.";
      throw new AssistantBackendError(message);
    }
    return body as T;
  };
}

export const requestTaskBackend = createTaskBackend();

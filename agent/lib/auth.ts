import { importKey } from "@workflow/core/encryption";
import { hydrateDataWithKey } from "@workflow/core/serialization-format";
import { getWorld } from "workflow/runtime";
import { observabilityRevivers } from "workflow/observability";
import { ForbiddenError, type AuthFn } from "eve/channels/auth";
import type { SessionAuthContext, SessionContext } from "eve/context";
import { isAssistantTeamActor, parseAssistantActor } from "../../lib/auth/actor";
import type { AssistantActor } from "../../lib/auth/actor";
import { assistantModelFromCookie, type AssistantModelId } from "../../lib/assistant/models";
import { readAssistantProxyOrigin, readAssistantSession } from "../../lib/auth/request";

const AUTHENTICATOR = "assistant-google-session";
const ISSUER = "https://accounts.google.com";

/** The chosen model rides along as a validated preference; it never affects identity checks. */
export function assistantActorPrincipal(actor: AssistantActor, model?: AssistantModelId): SessionAuthContext {
  return {
    authenticator: AUTHENTICATOR,
    issuer: ISSUER,
    principalId: actor.id,
    principalType: "user",
    attributes: {
      email: actor.email,
      ...(actor.name ? { name: actor.name } : {}),
      ...(model ? { model } : {}),
    },
  };
}

export function assistantActorFromPrincipal(value: unknown): AssistantActor | null {
  if (!value || typeof value !== "object") return null;
  const principal = value as Partial<SessionAuthContext>;
  if (principal.authenticator !== AUTHENTICATOR || principal.issuer !== ISSUER || principal.principalType !== "user") return null;
  const actor = parseAssistantActor({
    id: principal.principalId,
    email: principal.attributes?.email,
    ...(typeof principal.attributes?.name === "string" ? { name: principal.attributes.name } : {}),
  });
  return actor && isAssistantTeamActor(actor) ? actor : null;
}

/** Tools accept the authenticated runtime actor, never a model/user-supplied ID. */
export function requireAssistantContextActor(ctx: Pick<SessionContext, "session">): AssistantActor {
  const actor = assistantActorFromPrincipal(ctx.session.auth.current);
  const initiator = assistantActorFromPrincipal(ctx.session.auth.initiator);
  if (!actor || !initiator || actor.id !== initiator.id)
    throw new Error("Sign in to your own assistant conversation before using its tools.");
  return actor;
}

/** Immutable workflow arguments contain the principal that created this session. */
export function assistantSessionOwnerFromInput(input: unknown): AssistantActor | null {
  if (!Array.isArray(input) || input.length !== 1) return null;
  const entry = input[0];
  if (!entry || typeof entry !== "object" || !("serializedContext" in entry)) return null;
  const context = entry.serializedContext;
  if (!context || typeof context !== "object") return null;
  const auth = context as Record<string, unknown>;
  const initiator = assistantActorFromPrincipal(auth["eve.initiatorAuth"]);
  const originalCaller = assistantActorFromPrincipal(auth["eve.auth"]);
  return initiator && originalCaller && initiator.id === originalCaller.id
    && initiator.email === originalCaller.email ? initiator : null;
}

export async function decodeAssistantSessionOwner(input: unknown, rawKey?: Uint8Array): Promise<AssistantActor | null> {
  const key = rawKey ? await importKey(rawKey, ["decrypt"]) : undefined;
  const decoded = await hydrateDataWithKey(input, observabilityRevivers, key);
  return assistantSessionOwnerFromInput(decoded);
}

export async function readAssistantSessionOwner(sessionId: string): Promise<AssistantActor | null> {
  if (!/^wrun_[A-Za-z0-9_-]{8,100}$/.test(sessionId)) return null;
  try {
    const world = await getWorld();
    const run = await world.runs.get(sessionId, { resolveData: "all" });
    if (run.workflowName !== "workflow//eve//workflowEntry") return null;
    const key = await world.getEncryptionKeyForRun?.(run);
    return await decodeAssistantSessionOwner(run.input, key);
  } catch {
    // Missing, legacy/unowned, unreadable and foreign runs all fail closed.
    return null;
  }
}

export function assistantBrowserRequestAllowed(request: Request, verifiedOrigin: string | null): boolean {
  if (request.headers.get("sec-fetch-site") === "cross-site") return false;
  if (!verifiedOrigin) return false;
  const origin = request.headers.get("origin");
  if (!origin) return request.method === "GET" || request.method === "HEAD";
  try {
    const expected = new URL(verifiedOrigin);
    return ["http:", "https:"].includes(expected.protocol)
      && expected.origin === verifiedOrigin && origin === verifiedOrigin;
  } catch { return false; }
}

export function assistantGoogleAuth(dependencies: {
  session?: typeof readAssistantSession;
  owner?: typeof readAssistantSessionOwner;
  proxyOrigin?: typeof readAssistantProxyOrigin;
} = {}): AuthFn<Request> {
  const session = dependencies.session ?? readAssistantSession;
  const owner = dependencies.owner ?? readAssistantSessionOwner;
  const proxyOrigin = dependencies.proxyOrigin ?? readAssistantProxyOrigin;
  return async (request) => {
    if (request.headers.get("sec-fetch-site") === "cross-site") return null;
    const actor = await session(request);
    if (!actor || !parseAssistantActor(actor) || !isAssistantTeamActor(actor)) return null;
    if (!assistantBrowserRequestAllowed(request, await proxyOrigin(request, actor))) return null;
    const match = new URL(request.url).pathname.match(/\/eve\/v1\/session\/([^/]+)/);
    if (match) {
      const initiator = /^wrun_[A-Za-z0-9_-]{8,100}$/.test(match[1]) ? await owner(match[1]) : null;
      if (!initiator || initiator.id !== actor.id)
        throw new ForbiddenError({ message: "This conversation is not available to your account." });
    }
    return assistantActorPrincipal(actor, assistantModelFromCookie(request.headers.get("cookie")));
  };
}

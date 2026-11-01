import { decode, encode, getToken } from "next-auth/jwt";
import {
  isAssistantTeamActor,
  parseAssistantActor,
  assistantWorkspaceDomain,
} from "./actor";
import type { AssistantActor } from "./actor";

const SERVICE_SALT = "assistant-internal-service-v1";
const PROXY_SALT = "assistant-eve-proxy-v1";

export async function signAssistantProxyProof(
  actor: AssistantActor,
  origin: string,
): Promise<string> {
  const secret = authSecret();
  if (
    !secret ||
    !parseAssistantActor(actor) ||
    !isAssistantTeamActor(actor) ||
    new URL(origin).origin !== origin
  )
    throw new Error("Assistant authentication is not configured.");
  return encode({
    secret,
    salt: PROXY_SALT,
    maxAge: 60,
    token: {
      sub: actor.id,
      email: actor.email,
      workspaceDomain: assistantWorkspaceDomain(),
      sessionKind: "assistant-proxy",
      origin,
    },
  });
}

/** Verifies the server proxy's origin assertion; a browser header is not proof. */
export async function readAssistantProxyOrigin(
  request: Request,
  actor: AssistantActor,
): Promise<string | null> {
  const secret = authSecret();
  const proof = request.headers.get("x-assistant-origin-proof");
  if (!secret || !proof) return null;
  try {
    const claims = await decode({ secret, salt: PROXY_SALT, token: proof });
    const principal = actorFromClaims(claims, "assistant-proxy");
    const origin = claims?.origin;
    return principal?.id === actor.id &&
      principal.email === actor.email &&
      typeof origin === "string" &&
      origin === request.headers.get("x-assistant-original-origin") &&
      new URL(origin).origin === origin &&
      ["http:", "https:"].includes(new URL(origin).protocol)
      ? origin
      : null;
  } catch {
    return null;
  }
}

function authSecret(): string | undefined {
  const secret = process.env.AUTH_SECRET;
  return secret && secret.length >= 32 ? secret : undefined;
}

function actorFromClaims(
  claims: Record<string, unknown> | null,
  kind: string,
): AssistantActor | null {
  if (
    !claims ||
    claims.sessionKind !== kind ||
    claims.workspaceDomain !== assistantWorkspaceDomain()
  )
    return null;
  const actor = parseAssistantActor({
    id: claims.sub,
    email: claims.email,
    name: typeof claims.name === "string" ? claims.name : undefined,
  });
  return actor && isAssistantTeamActor(actor) ? actor : null;
}

/** Cookie-only verifier usable by Next and EVE; it never reads actor headers. */
export async function readAssistantSession(
  request: Request,
): Promise<AssistantActor | null> {
  const secret = authSecret();
  if (!secret) return null;
  const headers = new Headers({ cookie: request.headers.get("cookie") ?? "" });
  try {
    for (const secureCookie of [true, false]) {
      const token = await getToken({ req: { headers }, secret, secureCookie });
      const actor = actorFromClaims(token, "assistant-user");
      if (actor) return actor;
    }
  } catch {
    /* Invalid or expired cookies do not authenticate. */
  }
  return null;
}

/** Server-to-server delegation for EVE's protected task bridge, never the UI. */
export async function signAssistantServiceToken(
  actor: AssistantActor,
): Promise<string> {
  const secret = authSecret();
  if (!secret || !parseAssistantActor(actor) || !isAssistantTeamActor(actor))
    throw new Error("Assistant authentication is not configured.");
  return encode({
    secret,
    salt: SERVICE_SALT,
    maxAge: 60,
    token: {
      sub: actor.id,
      email: actor.email,
      name: actor.name,
      workspaceDomain: assistantWorkspaceDomain(),
      sessionKind: "assistant-service",
    },
  });
}

async function readServiceActor(
  request: Request,
): Promise<AssistantActor | null> {
  const secret = authSecret();
  const authorization = request.headers.get("authorization");
  if (!secret || !authorization?.startsWith("Bearer ")) return null;
  try {
    return actorFromClaims(
      await decode({
        secret,
        salt: SERVICE_SALT,
        token: authorization.slice(7),
      }),
      "assistant-service",
    );
  } catch {
    return null;
  }
}

export function assistantBrowserOriginAllowed(request: Request): boolean {
  if (request.headers.get("sec-fetch-site") === "cross-site") return false;
  const origin = request.headers.get("origin");
  if (!origin) return ["GET", "HEAD"].includes(request.method);
  try {
    const url = new URL(request.url);
    const host = request.headers.get("host") ?? url.host;
    return origin === `${url.protocol}//${host}`;
  } catch {
    return false;
  }
}

export async function requireAssistantActor(
  request: Request,
  { allowService = true }: { allowService?: boolean } = {},
): Promise<AssistantActor | Response> {
  const delegated = allowService ? await readServiceActor(request) : null;
  if (delegated) return delegated;
  const actor = assistantBrowserOriginAllowed(request)
    ? await readAssistantSession(request)
    : null;
  return (
    actor ??
    Response.json(
      { error: "Sign in with your Google account to continue." },
      { status: 401, headers: { "Cache-Control": "no-store" } },
    )
  );
}

import { createHash, timingSafeEqual } from "node:crypto";

function sameToken(actual: string, expected: string): boolean {
  const actualDigest = createHash("sha256").update(actual).digest();
  const expectedDigest = createHash("sha256").update(expected).digest();
  return timingSafeEqual(actualDigest, expectedDigest);
}

const loopbackHosts = new Set(["127.0.0.1", "localhost", "[::1]"]);

export function isLocalDemoRequest(request: Request): boolean {
  const url = new URL(request.url);
  if (!loopbackHosts.has(url.hostname)) return false;
  const host = request.headers.get("host");
  // Next's local Request URL can use localhost even when the browser visits
  // 127.0.0.1. Validate both as loopback, then check Origin against browser Host.
  let browserUrl: URL;
  try {
    browserUrl = host ? new URL(`${url.protocol}//${host}`) : url;
  } catch {
    return false;
  }
  if (!loopbackHosts.has(browserUrl.hostname) || browserUrl.port !== url.port)
    return false;
  const origin = request.headers.get("origin");
  if (origin && origin !== browserUrl.origin) return false;
  const site = request.headers.get("sec-fetch-site");
  return !site || site === "same-origin" || site === "none";
}

export function authorizeDemoRequest(
  request: Request,
  environment: { DEMO_ACCESS_TOKEN?: string; NODE_ENV?: string } = process.env,
): Response | null {
  // The development server binds to loopback. Credentials stay server-side;
  // cross-origin requests and deployed endpoints still require the bearer gate.
  if (environment.NODE_ENV === "development" && isLocalDemoRequest(request))
    return null;
  const expected = environment.DEMO_ACCESS_TOKEN;
  if (!expected)
    return Response.json(
      { error: "Demo access is not configured." },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  const authorization = request.headers.get("authorization") ?? "";
  if (
    !authorization.startsWith("Bearer ") ||
    !sameToken(authorization.slice(7), expected)
  ) {
    return Response.json(
      { error: "Unauthorized." },
      {
        status: 401,
        headers: { "WWW-Authenticate": "Bearer", "Cache-Control": "no-store" },
      },
    );
  }
  return null;
}

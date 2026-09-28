import { createHash, timingSafeEqual } from "node:crypto";

function sameToken(actual: string, expected: string): boolean {
  const actualDigest = createHash("sha256").update(actual).digest();
  const expectedDigest = createHash("sha256").update(expected).digest();
  return timingSafeEqual(actualDigest, expectedDigest);
}

export function authorizeDemoRequest(
  request: Request,
  environment: { DEMO_ACCESS_TOKEN?: string; NODE_ENV?: string } = process.env,
): Response | null {
  const expected = environment.DEMO_ACCESS_TOKEN;
  if (!expected && environment.NODE_ENV !== "production") return null;
  if (!expected) return Response.json({ error: "Demo access is not configured." }, { status: 503 });
  const authorization = request.headers.get("authorization") ?? "";
  if (!authorization.startsWith("Bearer ") || !sameToken(authorization.slice(7), expected)) {
    return Response.json({ error: "Unauthorized." }, {
      status: 401,
      headers: { "WWW-Authenticate": "Bearer", "Cache-Control": "no-store" },
    });
  }
  return null;
}

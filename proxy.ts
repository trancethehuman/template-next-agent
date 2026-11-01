import { NextResponse } from "next/server";
import {
  assistantBrowserOriginAllowed,
  readAssistantSession,
  signAssistantProxyProof,
} from "@/lib/auth/request";

/** Inspect the browser's original Host before the EVE dev proxy rewrites it. */
export async function proxy(request: Request) {
  const headers = new Headers(request.headers);
  headers.delete("x-assistant-original-origin");
  headers.delete("x-assistant-origin-proof");
  const actor = await readAssistantSession(request);
  if (!assistantBrowserOriginAllowed(request) || !actor)
    return Response.json(
      { error: "Sign in with your Google account to continue." },
      { status: 401, headers: { "Cache-Control": "no-store" } },
    );
  const url = new URL(request.url);
  const host = request.headers.get("host") ?? url.host;
  if (process.env.NODE_ENV === "development") {
    if (
      !["localhost", "127.0.0.1", "[::1]"].includes(
        new URL(`${url.protocol}//${host}`).hostname,
      )
    )
      return Response.json(
        { error: "Local assistant access requires a loopback host." },
        { status: 401 },
      );
  }
  const origin = new URL(`${url.protocol}//${host}`).origin;
  headers.set("x-assistant-original-origin", origin);
  headers.set(
    "x-assistant-origin-proof",
    await signAssistantProxyProof(actor, origin),
  );
  // The channel verifies the cookie again and checks ownership of the session.
  return NextResponse.next({ request: { headers } });
}

export const config = { matcher: "/eve/:path*" };

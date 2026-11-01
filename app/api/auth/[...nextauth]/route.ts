import { handlers, assistantAuthConfigured } from "@/auth";
import type { NextRequest } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function unavailable() {
  return Response.json(
    { error: "Google sign-in is not configured." },
    { status: 503, headers: { "Cache-Control": "no-store" } },
  );
}

export async function GET(request: NextRequest) {
  return assistantAuthConfigured() ? handlers.GET(request) : unavailable();
}

export async function POST(request: NextRequest) {
  return assistantAuthConfigured() ? handlers.POST(request) : unavailable();
}

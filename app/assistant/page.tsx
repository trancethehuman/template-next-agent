import type { Metadata } from "next";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { AssistantWorkspace } from "@/components/assistant/assistant-workspace";
import { AssistantLogin } from "@/components/assistant/assistant-login";
import { AssistantSessionBoundary } from "@/components/assistant/assistant-session-boundary";
import { auth, assistantAuthConfigured, signIn } from "@/auth";
import {
  parseAssistantActor,
  assistantWorkspaceDomain,
} from "@/lib/auth/actor";

export const metadata: Metadata = {
  title: "Always-on assistant | Agent examples",
  description:
    "Delegate a task, follow its durable workflow, and return when it is ready.",
};

export default async function AssistantPage({
  searchParams,
}: {
  searchParams: Promise<{
    view?: string | string[];
    run?: string | string[];
    error?: string | string[];
  }>;
}) {
  const query = await searchParams;
  // OAuth cookies and callbacks must share the configured canonical host.
  // The pinned NextRequest normalizes loopback IPs to localhost on callbacks.
  if (process.env.AUTH_URL) {
    const canonical = new URL(process.env.AUTH_URL);
    const requestHeaders = await headers();
    if (requestHeaders.get("host") !== canonical.host) {
      const target = new URL("/assistant", canonical);
      if (
        query.view === "connections" ||
        query.view === "story" ||
        query.view === "run" ||
        query.view === "inbox"
      )
        target.searchParams.set("view", query.view);
      if (typeof query.run === "string" && /^[A-Za-z0-9_-]{1,200}$/.test(query.run))
        target.searchParams.set("run", query.run);
      redirect(target.href);
    }
  }
  const configured = assistantAuthConfigured();
  const session = configured ? await auth() : null;
  const actor = session?.user
    ? parseAssistantActor({
        id: session.user.id,
        email: session.user.email,
        name: session.user.name ?? undefined,
      })
    : null;
  if (!actor || !session)
    return (
      <AssistantLogin
        configured={configured}
        workspaceDomain={assistantWorkspaceDomain()}
        workspaceName={process.env.AUTH_WORKSPACE_NAME}
        error={typeof query.error === "string" ? query.error : undefined}
        onSignIn={async () => {
          "use server";
          await signIn("google", { redirectTo: "/assistant" });
        }}
      />
    );
  return (
    <AssistantSessionBoundary session={session}>
      <AssistantWorkspace
        key={actor.id}
        actor={actor}
        initialView={query.view === "connections" ? "connections" : "assistant"}
        authorizationDenied={query.error === "access_denied"}
      />
    </AssistantSessionBoundary>
  );
}

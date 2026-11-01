import NextAuth from "next-auth";
import type { NextAuthConfig } from "next-auth";
import Google from "next-auth/providers/google";
import {
  actorFromGoogleProfile,
  assistantWorkspaceDomain,
  isAssistantTeamActor,
  parseAssistantActor,
} from "@/lib/auth/actor";

export function assistantAuthConfigured(): boolean {
  return Boolean(
    process.env.AUTH_GOOGLE_ID &&
    process.env.AUTH_GOOGLE_SECRET &&
    process.env.AUTH_SECRET &&
    process.env.AUTH_SECRET.length >= 32,
  );
}

export function assistantAuthConfig(): NextAuthConfig {
  const domain = assistantWorkspaceDomain();
  return {
    secret: process.env.AUTH_SECRET,
    trustHost: true,
    session: { strategy: "jwt", maxAge: 8 * 60 * 60 },
    providers: [
      Google({
        clientId: process.env.AUTH_GOOGLE_ID,
        clientSecret: process.env.AUTH_GOOGLE_SECRET,
        authorization: {
          params: {
            scope: "openid email profile",
            ...(domain ? { hd: domain } : {}),
            prompt: "select_account",
          },
        },
      }),
    ],
    pages: { signIn: "/assistant", error: "/assistant" },
    logger: {
      error(error) {
        const inner = (
          error.cause as
            | { err?: Error & { code?: string; cause?: { error?: string } } }
            | undefined
        )?.err;
        const providerCode = inner?.cause?.error;
        const known = [
          "invalid_client",
          "invalid_grant",
          "access_denied",
          "redirect_uri_mismatch",
        ];
        console.error(
          "[assistant-auth]",
          error.name,
          inner?.name ?? "",
          providerCode && known.includes(providerCode) ? providerCode : "",
        );
      },
      warn(code) {
        console.warn("[assistant-auth]", code);
      },
    },
    callbacks: {
      signIn({ account, profile }) {
        return (
          account?.provider === "google" &&
          actorFromGoogleProfile(profile) !== null
        );
      },
      jwt({ token, account, profile }) {
        if (account) {
          const actor =
            account.provider === "google"
              ? actorFromGoogleProfile(profile)
              : null;
          return actor
            ? {
                sub: actor.id,
                email: actor.email,
                name: actor.name,
                workspaceDomain: assistantWorkspaceDomain(),
                sessionKind: "assistant-user",
              }
            : null;
        }
        const actor = parseAssistantActor({
          id: token.sub,
          email: token.email,
          name: token.name ?? undefined,
        });
        return actor &&
          isAssistantTeamActor(actor) &&
          token.workspaceDomain === assistantWorkspaceDomain() &&
          token.sessionKind === "assistant-user"
          ? token
          : null;
      },
      session({ session, token }) {
        session.user.id = String(token.sub);
        session.user.email = String(token.email);
        session.user.name = typeof token.name === "string" ? token.name : null;
        return session;
      },
    },
  };
}

export const { handlers, auth, signIn, signOut } =
  NextAuth(assistantAuthConfig);

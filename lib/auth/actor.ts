/** Verified Google identity, supplied only by the server authentication boundary. */
export interface AssistantActor {
  id: string;
  email: string;
  name?: string;
}
import { z } from "zod";

const actorSchema = z
  .object({
    id: z.string().regex(/^google:[A-Za-z0-9_-]{1,128}$/),
    email: z.email().max(254),
    name: z.string().max(200).optional(),
  })
  .strict();

/** Shape validation only. Authentication belongs at the request boundary. */
export function parseAssistantActor(raw: unknown): AssistantActor | null {
  const result = actorSchema.safeParse(raw);
  return result.success ? result.data : null;
}

export function assistantWorkspaceDomain(): string | undefined {
  return (
    process.env.AUTH_GOOGLE_WORKSPACE_DOMAIN?.trim().toLowerCase() || undefined
  );
}

export function isAssistantTeamActor(actor: AssistantActor): boolean {
  const domain = assistantWorkspaceDomain();
  if (!domain) return true;
  return (
    /^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/.test(domain) &&
    actor.email.toLowerCase().endsWith(`@${domain}`)
  );
}

/** Called only with the Google profile verified by Auth.js's OAuth/OIDC flow. */
export function actorFromGoogleProfile(
  profile: unknown,
): AssistantActor | null {
  const result = z
    .object({
      sub: z.string(),
      email: z.email(),
      email_verified: z.literal(true),
      hd: z.string().optional(),
      name: z.string().optional(),
    })
    .safeParse(profile);
  const domain = assistantWorkspaceDomain();
  if (!result.success || (domain && result.data.hd?.toLowerCase() !== domain))
    return null;
  const actor = parseAssistantActor({
    id: `google:${result.data.sub}`,
    email: result.data.email.toLowerCase(),
    name: result.data.name?.slice(0, 200),
  });
  return actor && isAssistantTeamActor(actor) ? actor : null;
}

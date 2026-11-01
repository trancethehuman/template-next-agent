# Google sign-in for the assistant

The assistant uses Auth.js 5 with Google OpenID Connect and encrypted JWT session cookies. It needs no user database. Google sign-in identifies the person; Vercel Connect separately obtains that person's Calendar permission. Transaction classification retains its existing demo-token gate.

## Configure your clone

1. Create a Google web OAuth client in your own project. Register the exact local redirect `http://localhost:3000/api/auth/callback/google`. Add your real HTTPS application origin plus `/api/auth/callback/google` before deploying. Google may require a consent screen, organization configuration or test users. Use your own client credentials.
2. Fill in the ignored `.env.local` values:

   ```dotenv
   AUTH_GOOGLE_ID=
   AUTH_GOOGLE_SECRET=
   AUTH_SECRET=
   AUTH_URL=http://localhost:3000
   AUTH_GOOGLE_WORKSPACE_DOMAIN=
   AUTH_WORKSPACE_NAME=
   ```

   Generate a fresh random `AUTH_SECRET` with at least 32 characters. Keep it and the Google client secret server-side; never put either in chat, logs, screenshots, fixtures or source control. Both Next and EVE need the same session secret within an environment. Configure the corresponding Vercel environment explicitly. Use a separate secret for separate environments.

3. Leave `AUTH_GOOGLE_WORKSPACE_DOMAIN` empty to allow any verified Google account. To limit a deployment to a Workspace organization, set its domain. The server checks Google's verified email, hosted-domain claim and email domain; Google's account-picker hint alone is not authorization. `AUTH_WORKSPACE_NAME` is optional display text. The AGI demo sets these values in its environment; clones contain no personal account or mandatory organization.
4. Restart development and open `http://localhost:3000/assistant`. Sign in, then use Connections for optional Calendar consent. See [calendar setup](ASSISTANT-CALENDAR.md).

`AUTH_URL` is the canonical application origin. The assistant redirects other hostnames there before sign-in so OAuth cookies and callbacks use one host. With this pinned Next version, use `localhost` for local Google sign-in: its callback `NextRequest` normalizes a loopback IP to `localhost`, which otherwise causes a Google token-exchange redirect mismatch. Vercel deployments need their actual HTTPS origin and a matching Google redirect URI.

Development logging excludes Auth.js and Calendar return routes so one-time OAuth callback codes do not appear in request logs. Auth error logging reports only error classes and allowlisted provider error codes, without provider response bodies, profiles, or tokens.

## Identity and access

Only Google profiles verified by the OAuth/OIDC flow can create a session. Unverified emails are rejected. Google subject IDs provide stable ownership across email changes. Session cookies are HttpOnly, encrypted, SameSite=Lax, and Secure on HTTPS. Sessions last eight hours. Google access/refresh credentials are not included in the application session or sent to the model. Changing the Workspace restriction invalidates sessions issued for the previous policy.

Every assistant API verifies the session and request origin. EVE also requires a short-lived, purpose-bound origin proof issued by the Next proxy. The proxy removes incoming proof headers, verifies the browser, and signs its own assertion. EVE checks the immutable creator identity before attaching a session for reading, streaming, continuation or controls. A known run ID does not authorize another person.

Tasks, preferences, quotas and idempotency keys are scoped to the authenticated actor. Background work stores a trusted owner snapshot; it cannot choose a browser-supplied account. EVE calls Next with a short-lived actor delegation token, which cannot approve or decline a proposal. Owner decisions require the matching browser session and same-origin request. The model also has no approval action in its tool schema.

Calendar grants use each person's Google subject as the Vercel Connect subject. The provider verifies that the connected primary calendar matches that person's verified email before reading or writing. Neither a client-supplied user ID nor a legacy fixed-owner environment variable selects the account.

## Retention and limits

Browser storage holds only an actor-scoped EVE session ID, not authentication tokens or transcript content. Signing out clears the application session; it does not cancel durable work, revoke Calendar consent or delete history. Revoke Calendar access through Google or Vercel Connect. Legacy shared sessions, tasks and preferences without verified ownership are not automatically exposed or migrated.

Auth.js broadcasts sign-out across tabs. The assistant removes an old workspace when that session ends or changes account. Chat drafts remain in component memory during transport failures; messages appear as sent only after a durable receipt.

Workflow persists task and conversation data in its backing World. Local task/preference records use ignored `.workflow-data`; EVE uses its separate `.eve/.workflow-data`. Builds must not clear either directory. See [assistant retention](ASSISTANT.md#storage-and-retention). Organization membership is checked at sign-in; this stateless starter does not implement a central session-revocation store or comprehensive rate limiting.

References: [Auth.js Google provider](https://authjs.dev/getting-started/providers/google), [Auth.js session strategies](https://authjs.dev/concepts/session-strategies), [Google hosted-domain claim](https://developers.google.com/identity/openid-connect/openid-connect#an-id-tokens-payload), [Next.js authentication](https://nextjs.org/docs/app/guides/authentication).

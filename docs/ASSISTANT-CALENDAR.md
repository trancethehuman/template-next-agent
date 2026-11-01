# Google Calendar for the assistant

The assistant reads upcoming events and free/busy windows through the Google Calendar REST API, using short-lived credentials from Vercel Connect. The starter defaults to read-only. An explicitly enabled installation can also create a private event on a signed-in user's primary calendar after that user approves its exact draft in the task inbox.

## Sign-in and account isolation

The assistant requires Google sign-in through the application's authentication boundary. A clone accepts verified Google accounts by default. An operator can set `AUTH_GOOGLE_WORKSPACE_DOMAIN` to restrict an installation to a Google Workspace organization. When configured, Workspace membership and verified email are checked on the server. A matching-looking email supplied by a browser or model is not authentication.

The server supplies `AssistantActor {id, email, name?}`, where `id` is `google:` followed by Google's verified stable subject. Calendar consent and token requests use that actor ID as the Vercel Connect subject. Each actor must authorize Calendar independently. The Calendar provider always targets `primary`, reads Google's actual primary-calendar ID before event reads or writes, and verifies that it matches the actor's verified email. Connecting a different Google account fails closed without exposing its events.

Tasks persist their trusted owner when started. Background steps use that same actor; they do not pick an account from a model argument, request body, global environment variable, or whichever user signs in later. Chat sessions, task visibility, task controls, and approval endpoints enforce ownership through their own server boundaries. Legacy runs without a trusted owner and the old `assistant-owner` Calendar grant are not available to signed-in users. Sharing a transaction-demo bearer token grants no assistant access.

The live Calendar exports require an actor. `createCalendarClientForActor(actor)` binds the subject, primary calendar, and email verification to that actor and ignores legacy `ASSISTANT_GOOGLE_SUBJECT_ID`, `ASSISTANT_CALENDAR_OWNER_EMAIL`, and `ASSISTANT_CALENDAR_ID` values. The low-level injected factory exists for provider fixtures; normal application paths use the actor-bound factory.

## Project and connector setup

Link the checkout to your own Vercel project. The project uses Node.js 24, Next.js, `bun install --frozen-lockfile`, and `bun run build`. Linking a project does not deploy it.

Use one Google connector for the project, attached only to the environments that need it; a local demo needs only **Development**. Its OAuth client credentials remain in protected Vercel configuration. A grant created for an earlier fixed owner is not reused by the new user-account flow. Connector creation or a successful sign-in does not establish Calendar consent for another actor.

1. Configure the application's Google sign-in as described in [AUTH.md](AUTH.md). The login OAuth client and Calendar authorization have different jobs: sign-in establishes a verified application identity; Vercel Connect manages that identity's Calendar grant. Set `AUTH_GOOGLE_WORKSPACE_DOMAIN` only if this installation should restrict access to an organization; otherwise leave it empty. A configured restriction is checked at sign-in and on protected assistant requests. Each clone supplies its own Google OAuth client, Vercel project, connector, and server secrets.

2. Link the checkout to the intended Vercel team and project using Node.js 24 and Bun. Inspect current connectors and reuse only an appropriate one.

   ```sh
   bunx vercel link
   bunx vercel connect create google --help
   bunx vercel connect list --all-projects
   ```

3. Create a Google OAuth connector if needed. Google currently requires your own web OAuth client ID and secret. Enable the Calendar API in the intended Google Cloud project, configure its consent screen and test users as appropriate, and register the exact provider redirect URI `https://connect.vercel.com/callback`. Enter credentials through Vercel's protected setup, never chat, shell arguments, screenshots, or this public source tree.

   ```sh
   bunx vercel connect create google --name assistant-calendar
   bunx vercel connect attach '<returned-connector-uid>' -e development
   ```

   Creation, project attachment, application sign-in, and a user's Calendar consent are separate steps. Use the actual returned UID. Attach preview or production explicitly only when those environments need access.

4. Configure these server-side Calendar settings in `.env.local` and the corresponding Vercel environment:

   ```dotenv
   ASSISTANT_GOOGLE_CONNECTOR=<returned-connector-uid>
   ASSISTANT_CALENDAR_WRITE_ENABLED=false
   ```

   Keep the flag false for read-only access. The exact value `true` additionally requests `https://www.googleapis.com/auth/calendar.events.owned`, alongside `https://www.googleapis.com/auth/calendar.readonly`. Every user must consent to the requested scopes. The actor's verified email supplies the required owner pin automatically; there is no shared personal subject or owner-email setting in the normal app. The write flag permits proposals, not arbitrary unapproved writes.

5. Pull a same-project development OIDC token into an ignored temporary env file, merge only the needed entry into `.env.local`, and remove the temporary file. Preserve existing credentials and never print their values.

   ```sh
   bunx vercel env pull .env.connect.local
   ```

   Refresh expired development tokens this way. Vercel supplies runtime OIDC on deployments. Do not copy credentials from another repository.

6. Restart development, sign in, open `/assistant`, and connect Calendar for that account. The consent endpoint returns only Vercel's authorization URL for the authenticated actor. On return, the app checks actual access; a return navigation does not assert successful consent.

   Vercel Connect currently allows an HTTP `localhost` return URL while its service rejects HTTP `127.0.0.1`. A development-only redirect bridge restores the original validated loopback origin and port, preserving the browser's application sign-in cookie. It cannot read calendar/session data, rejects external or changed-port targets, and is disabled in production. HTTPS production callbacks return directly to the app.

Calendar API access itself does not require `AI_GATEWAY_API_KEY`. AI chat and live model-generated meeting briefs do. Preserve `WORKFLOW_LOCAL_HEADERS_TIMEOUT_MS=90000` for slow local model steps.

## Reads and connection state

- `GET /api/assistant/calendar` requires the authenticated actor and returns that actor's live connection state and up to 20 events in the next seven days. `truncated` means more results exist; a truncated list cannot establish availability.
- `POST /api/assistant/calendar/authorize` requires the authenticated actor and starts that actor's consent. Provider tokens, OAuth verifier, refresh credentials, and client secrets never cross this HTTP boundary.
- `listCalendarEvents(actor, {timeMin?, timeMax?, limit?})` supports 1–50 results and a window of at most 31 days.
- `findCalendarAvailability(actor, {timeMin, timeMax, durationMinutes, timeZone?})` uses Google's complete free/busy response rather than the bounded event list. It returns up to 12 candidates, one per sufficient gap. The caller chooses the window; business hours are not inferred. Overlapping busy periods and offsets are handled in code.

Status includes `writeEnabled`, `capabilities`, and the verified calendar owner when matched. In write mode the connection probe requests the combined scopes; an old read-only grant cannot produce a writable capability. Missing consent, denied scopes, the wrong Google account, provider failures, and malformed responses remain visible. They never become invented calendar data.

Read metadata is minimized to event ID, title, timed/all-day boundaries, optional location, time zone, and a verified Google calendar URL. Descriptions and attendee lists are not returned by the read tool. Google's all-day end date is exclusive.

## User-approved writes

`CalendarEventDraft` contains only `summary`, optional `description`, `start`, `end`, and `timeZone`. The strict shared schema rejects attendees, conference data, calendar selectors, arbitrary extended properties, and other fields. Titles are at most 160 characters and descriptions 2,000. Dates require explicit offsets, the time zone must be an IANA zone, the duration is 5–480 whole minutes, and the start must be in the future within 365 days. Time-sensitive validation runs at proposal and write time.

The EVE tool can propose a draft and start an actor-owned durable approval workflow. It has no direct Google mutation tool. The task inbox shows the exact title, description, times, and time zone. Only that task's authenticated owner can approve the current checkpoint. Denying or stopping an unapproved proposal produces no Calendar write. The immutable approved draft becomes the provider payload.

`createManagedCalendarEvent(actor, draft, actionId)` creates a timed event with:

- A deterministic Google event ID derived from the verified actor and durable action ID.
- Private visibility, disabled default reminders, no attendees or conferences, and `sendUpdates=none`.
- Private application ownership and payload-hash markers.
- An exact readback before the task reports a confirmed result.

On HTTP 409, the provider reads that exact event ID and verifies the actor marker, payload hash, current fields, privacy, reminders, and absence of attendees, conferences, or recurrence before reuse. A changed, deleted, or foreign event fails closed. `managedCalendarEventIdForActor(actor, actionId)` provides a reconciliation ID without calling Google. An unconfirmed network outcome may already have reached Google: inspect that ID before creating another proposal. Stopping after approval cannot retract an external request already in flight.

`deleteManagedCalendarEvent(actor, actionId)` is an internal helper for explicitly authorized cleanup of that actor's assistant-created event. It verifies the owner marker, unchanged approved payload, private visibility, disabled reminders, and absence of attendees, conferences, or recurrence, then uses an ETag conditional delete with notifications disabled. It cannot select an arbitrary event or another actor's event. There is no direct public event-write or deletion endpoint.

## Retention

Calendar HTTP responses use `Cache-Control: no-store`; outbound requests disable caching, refuse redirects, and have timeouts. This provider boundary adds no calendar database or browser storage. Vercel Connect retains user grants and manages refresh and its in-process token cache, keyed to the actor's subject. Provider-rejected credentials are evicted. Revoke the relevant grant through Google or Vercel Connect to disconnect.

Calendar details and drafts can enter the actor's durable EVE conversation state, Workflow input/step results, task output, and AI Gateway model context. Approved events and private markers persist in Google Calendar until explicitly removed; completing or cancelling a task does not automatically delete an event. See [ASSISTANT.md](ASSISTANT.md) and [SECURITY.md](SECURITY.md) for session/task retention and authorization. Use synthetic content for teaching, and never expose user data through an anonymously shared demo.

## Verification

`bun test tests/backend/assistant-calendar.test.ts` covers read mapping, all-day boundaries, pagination, distinct actor subjects and event IDs, wrong-account isolation, legacy-grant rejection, revoked consent, safe failures, availability, disabled writes, strict drafts, safe retries, conditional cleanup, and the local return bridge. Synthetic HTTP fixtures do not establish a live user's Google connection or an actual write. Live QA must sign in as the intended Google user permitted by this installation, complete that user's own Calendar consent, inspect a known source event, approve a synthetic proposal, and verify its actual Google result and any explicitly requested cleanup. A previous fixed-owner grant is not proof that the new signed-in account flow works.

References: [Vercel Google connector](https://vercel.com/connect/google), [Connect quickstart](https://vercel.com/docs/connect/quickstart), [Google scopes](https://developers.google.com/workspace/calendar/api/auth), [events.insert](https://developers.google.com/workspace/calendar/api/v3/reference/events/insert), [events.delete](https://developers.google.com/workspace/calendar/api/v3/reference/events/delete), [extended properties](https://developers.google.com/workspace/calendar/api/guides/extended-properties).

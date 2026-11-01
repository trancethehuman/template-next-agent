# Security and data handling

This is a starter and a demo, not a production accounting service. Use the included fictional transactions by default.

## Where uploaded data goes

1. The browser parses and validates a CSV and displays a preview. Merely selecting a file does not start a server run.
2. When the user starts classification, the browser sends up to 25 normalized transaction rows to `POST /api/runs`. The endpoint validates the body again and starts a Workflow SDK run.
3. Workflow stores the run arguments and progress stream so steps can resume and the table can receive row-level status. Local development uses the Workflow local World; Vercel deployments use the Vercel World.
4. Deterministic rules resolve clear matches. Remaining rows send their date, description, amount, direction, and currency to the selected evaluation model through Vercel AI Gateway. Every rerun repeats this transmission in a new Workflow run.
5. `GET /api/runs/{runId}/stream` streams the run's row statuses, structured answers, probability distributions, provider confidence when available, and timings. These events can contain uploaded transaction descriptions. Treat them as sensitive.

The starter does not include automatic deletion of Workflow run data or a bank connection. Configure a retention and deletion policy with the backing Workflow World before handling real financial data. Review the AI Gateway and model provider's data-processing terms for your deployment. The code requests Gateway zero data retention for Jev evaluation, but that request does not replace a contractual or deployment review.

The Jev and Microsoft paths request Gateway zero data retention. OpenAI Decisions API (GPT-6 Luna), Liquid D1, and Laya currently do not advertise compatible zero retention in the catalogue. The API rejects these selections unless `syntheticData: true` is explicitly supplied, and the CSV UI requires an acknowledgement. Their calls omit the zero-retention constraint. This assertion does not anonymize an upload or establish that it is synthetic; operators must use fictional examples.

The UI retains up to 20 run comparisons in component memory, cleared when inputs change or the page reloads. This does not remove the backing Workflow records. There is no new database, browser local storage, or outbound financial action. Both run creation and progress inspection remain gated as described below.

## Access control

`bun run dev` binds to `127.0.0.1`. In `NODE_ENV=development`, loopback requests with a matching Host and absent or same-origin Origin / Fetch Metadata use the server configuration automatically, even when `DEMO_ACCESS_TOKEN` is set. No server secret is sent to the browser. Do not override the development hostname to expose this local mode. Cross-origin and non-loopback requests require the bearer token. In production, all start and stream requests require the configured token, including loopback; endpoints fail closed if it is absent. Enter it in the deployed demo's Settings password field; the page holds it in component memory and sends it in the Authorization header. Never put it in a URL, screenshot, issue, fixture, or commit.

The token is a shared demo gate. Everyone with it can call the run endpoints and inspect a run if they know its ID. It is not user identity, per-user authorization, or a rate limit. For a public multi-user service, add real authentication, run ownership checks, request and model-call rate limits, abuse controls, and a retention policy. Keep uploads bounded and scan logs for accidental transaction text before inviting external users.

The assistant and EVE agent require per-user Google sign-in, verified through Auth.js JWT session cookies. A configured `AUTH_GOOGLE_WORKSPACE_DOMAIN` restricts an installation to that Workspace organization; clones accept verified Google accounts by default. The transaction demo token and anonymous loopback mode do not grant assistant access. Chat sessions, task reads, streams, controls, and approvals enforce the authenticated actor's ownership; unowned legacy records and other users' work are hidden. EVE's internal task bridge uses short-lived signed actor delegation rather than browser-supplied owner headers. Calendar grants use each actor's distinct Vercel Connect subject, and the provider verifies the primary calendar's owner against that actor's verified email. Enabled Calendar writes require that same user's exact proposal approval before a bounded private-event write. The development proxy validates the original browser request before EVE rewrites its runtime address. General shell, file, arbitrary fetch, delegation, and framework task tools remain disabled. See [AUTH.md](AUTH.md), [ASSISTANT.md](ASSISTANT.md), and [ASSISTANT-CALENDAR.md](ASSISTANT-CALENDAR.md) for authentication, OAuth, approval, and retention details.

Supabase client helpers are optional and unused by the transaction demo. If you add a Supabase-backed feature, use its publishable key in the browser, define user ownership, and enable and test Row Level Security on exposed tables. These helpers alone do not implement sign-in or authorization. See [SUPABASE.md](SUPABASE.md).

## Credentials

Create `.env.local` from `.env.local.example` and enter your own secrets. `.env.local` is ignored by Git. Set `AI_GATEWAY_API_KEY` for local live Jev and EVE calls, or use project OIDC after linking a Vercel project. Set `DEMO_ACCESS_TOKEN` in the Vercel environment before deployment. Rotate a token if it appears in a log, screenshot, issue, or Git history.

Do not report vulnerabilities with real transaction data or credentials in public GitHub issues.

The public `/api/models` endpoint returns only allowlisted prices and context capacity from Gateway's public catalogue, cached for up to one hour. It uses no credentials and sends no transaction content. Missing stats stay missing and do not prevent running the demo.

## Assistant cloud browser

The assistant's `browser` tool is the one capability that reaches arbitrary websites. It runs Google Chrome inside a per-user Vercel Sandbox, an isolated Firecracker microVM with open egress so it can browse the web. No application secret, OAuth token, or session cookie is placed in the sandbox. The model sees only screenshots and short action summaries; page text is untrusted data.

- **Authorization.** Each signed-in account maps to one sandbox through a hash of its account ID, so a request can only see or stop its own browser. `/api/assistant/browser` accepts only a browser session (no service delegation), reports status, and stops the sandbox; it never starts one. The first browser action in a conversation needs the user's approval.
- **Live view.** noVNC is served from the sandbox's public `*.vercel.run` address on port 6080, behind a VNC password derived from `AUTH_SECRET` and the sandbox name. The password travels only in the owner's status response. Anyone holding that URL can watch the browser, and can control it if they change `view_only`; treat it like a short-lived session link. The address answers only while the sandbox runs, and the sandbox sleeps after its idle window (30 minutes by default, never more than 60), so a forgotten demo does not stay reachable. VNC and Chrome's debugging port (9222, used by agent-browser) listen only inside the sandbox and are never exposed.
- **Driver.** agent-browser is installed from npm at a pinned version (`0.41.0`) with install scripts disabled; its package bundles the Linux binary. It attaches to the visible Chrome and never launches or downloads another browser.
- **Commitments.** The agent's instructions forbid signing in, creating accounts, entering payment or personal details, accepting terms, solving CAPTCHAs, and completing purchases. As a backstop, the tool refuses to type text shaped like a payment card number. These are model-level and heuristic controls, not a guarantee; users finish checkout themselves with **Take control**.
- **Retention.** Each sandbox is persistent: its disk, including Chrome's profile, the list of open tabs, and any cookies or sign-ins set while browsing or while the user had control, is kept across stops so the browser resumes where it left off. Only the latest snapshot is retained, and it expires 30 days after its last use. Screenshots, page element lists, and summaries persist in the EVE conversation history like other tool results. Delete a user's sandbox and its snapshot from the Vercel dashboard or `sandbox` CLI to remove that disk.
- **Cost and limits.** Sandboxes use 2 vCPUs and sleep 30 minutes after their last start, agent action, or Keep awake (`ASSISTANT_BROWSER_IDLE_MINUTES`, 5–60). An open page alone never extends them; the live-view port's traffic is billable. Set `ASSISTANT_BROWSER_ENABLED=false` to remove the capability from a deployment.

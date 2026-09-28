# Security and data handling

This is a starter and a demo, not a production accounting service. Use the included fictional transactions by default.

## Where uploaded data goes

1. The browser parses and validates a CSV and displays a preview. Merely selecting a file does not start a server run.
2. When the user starts classification, the browser sends up to 25 normalized transaction rows to `POST /api/runs`. The endpoint validates the body again and starts a Workflow SDK run.
3. Workflow stores the run arguments and progress stream so steps can resume and the table can receive row-level status. Local development uses the Workflow local World; Vercel deployments use the Vercel World.
4. Deterministic rules resolve clear matches. Remaining rows send their date, description, amount, direction, and currency to TypeSafe Jev through Vercel AI Gateway.
5. `GET /api/runs/{runId}/stream` streams the run's row statuses and results. These events can contain uploaded transaction descriptions. Treat them as sensitive.

The starter does not include automatic deletion of Workflow run data or a bank connection. Configure a retention and deletion policy with the backing Workflow World before handling real financial data. Review the AI Gateway and model provider's data-processing terms for your deployment. The code requests Gateway zero data retention for Jev evaluation, but that request does not replace a contractual or deployment review.

## Access control

In local development, the run endpoints can work without a token. In production, the endpoints fail closed if `DEMO_ACCESS_TOKEN` is absent. When configured, the same bearer token is required to start a run and read its progress stream. Enter it in the demo page's password field; the page holds it in component memory and sends it in the Authorization header. Never put it in a URL, screenshot, issue, fixture, or commit.

The token is a shared demo gate. Everyone with it can call the run endpoints and inspect a run if they know its ID. It is not user identity, per-user authorization, or a rate limit. For a public multi-user service, add real authentication, run ownership checks, request and model-call rate limits, abuse controls, and a retention policy. Keep uploads bounded and scan logs for accidental transaction text before inviting external users.

The optional EVE agent accepts local development sessions and Vercel OIDC callers. It does not use anonymous production access. Keep its default shell, file, arbitrary fetch, delegation, and task tools disabled when extending it for financial workflows.

Supabase client helpers are optional and unused by the transaction demo. If you add a Supabase-backed feature, use its publishable key in the browser, define user ownership, and enable and test Row Level Security on exposed tables. These helpers alone do not implement sign-in or authorization. See [SUPABASE.md](SUPABASE.md).

## Credentials

Create `.env.local` from `.env.local.example` and enter your own secrets. `.env.local` is ignored by Git. Set `AI_GATEWAY_API_KEY` for local live Jev and EVE calls, or use project OIDC after linking a Vercel project. Set `DEMO_ACCESS_TOKEN` in the Vercel environment before deployment. Rotate a token if it appears in a log, screenshot, issue, or Git history.

Do not report vulnerabilities with real transaction data or credentials in public GitHub issues.

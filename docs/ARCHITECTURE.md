# Architecture

`next.config.ts` composes `withEve` and `withWorkflow` around the Next.js App Router. The app has two examples of AI integration with different jobs:

- **Jev through AI SDK** makes a typed, closed-set judgment about a transaction. It does not operate a tool loop or manage a conversation.
- **EVE** is an independent, protected example assistant that explains the starter. It does not classify or modify transactions.
- **Workflow SDK** runs the durable transaction process, checkpoints steps, and carries the progress stream.

## Transaction path

1. `app/page.tsx` lists the available use cases. `/transactions` renders `components/transactions/transactions-playground.tsx`, where users can select individual mock rows or upload a CSV.
2. `lib/transactions/csv.ts` parses a selected CSV in the browser. It limits input to 64 KB and 25 rows; sample rows come from `lib/transactions/mock.ts`.
3. `POST /api/runs` validates the normalized rows again with `lib/classification/input.ts` and starts `workflows/classify-transactions.ts`.
4. Each Workflow step checks `lib/classification/rules.ts` first. Rows needing semantic judgment call `lib/classification/jev.ts`, which uses AI SDK `experimental_evaluate` and Gateway model `typesafe-ai/jev`.
5. Steps write newline-delimited JSON row and batch events to the run's durable stream. The workflow processes up to four rows per batch and emits `processing` and `completed` batch boundaries. `GET /api/runs/{runId}/stream` reads the stream and supports a `startIndex` query for resumed reads. The browser folds those events into batch progress and a clickable step history for each row, then retries a dropped connection up to three times from the last event index.

The row progress values are `queued`, `rules`, `jev`, `classified`, `needs_review`, and `failed`. A result records whether a deterministic rule or Jev selected it. Uncertain or inconsistent Jev answers are shown for review; the demo does not post a bookkeeping entry. Workflow steps can replay after a local queue retry, so the browser ignores backward progress events after a terminal row or completed batch.

Run selection lives in browser component state. Reloading the page clears the current table, though the Workflow run can continue in its backing World.

## Runtime and deployment

The Workflow SDK uses its local World during local development and the Vercel World after a Vercel deployment. Keep `WORKFLOW_LOCAL_HEADERS_TIMEOUT_MS=90000` from `.env.local.example` locally so slower Jev responses do not exceed the local queue's response-header timeout. The stream route is configured for cancellation on client disconnect in `vercel.json`; the run continues independently. EVE's authored agent lives in `agent/`, and its HTTP channel accepts local development or Vercel OIDC authentication. Its general shell, file, web, delegation, and task tools are disabled.

The starter has no application database. Optional `lib/supabase/` browser and server helpers are inactive until configured and called; the transaction path does not use them. Workflow run arguments and stream events still persist in its backing World, including uploaded descriptions. Read [SECURITY.md](SECURITY.md) before using real transaction data or exposing the app publicly.

## Extending the directory

Add a focused route under `app/`, link it from the home directory, and keep its parsing, model questions, workflow, and UI separate from other examples. Install only the shadcn and AI Elements components the use case needs. Add tests for validation, uncertain outcomes, progress events, and route access control. Read the relevant `skills/<name>/SKILL.md` and the installed package docs before using a new API.

# AGENTS.md — template-next-agent

This repository is an open source Next.js starter. It is deliberately small: the home page is a use case directory and `/transactions` demonstrates CSV import, TypeSafe Jev classification, and per-transaction Workflow SDK progress. Keep synthetic data in examples and tests.

## First run

Use Node.js 24 and Bun. Do not use npm, pnpm, or yarn for dependency management or scripts.

```bash
bun install
cp .env.local.example .env.local
```

Open `.env.local` and supply `AI_GATEWAY_API_KEY` for local Jev and EVE calls. Set `DEMO_ACCESS_TOKEN` before exposing the classification endpoints on a public deployment. Supabase is optional: leave both `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` empty unless a new feature needs a Supabase project. `.env.local` is ignored by Git; `.env.local.example` is the only environment template to commit. Never copy credentials from another repository or put them in a prompt, log, test fixture, screenshot, or commit. If a required credential is missing, report the missing variable name and continue with work that does not require its value.

```bash
bun run dev
bun run test
bun run lint
bun run lint:design
bun run typecheck
bun run build
```

`bun run build:vercel` checks Vercel's assembled output and requires a linked Vercel project. Run it after linking the project and setting the deployment environment.

## Project boundaries

- `app/` contains the App Router pages and route handlers.
- `components/ui/` contains shadcn generated primitives; `components/ai-elements/` contains installed AI Elements source.
- `lib/transactions/` contains transaction types and CSV validation. `lib/classification/` contains deterministic checks and Jev evaluation.
- `workflows/` contains durable orchestration. Keep external I/O, Jev calls, and stream writes in `"use step"` functions. A `"use workflow"` function coordinates steps only.
- `agent/` contains the EVE agent. Do not broaden its default capability surface or expose private session routes anonymously.
- `lib/supabase/` contains optional browser and server client helpers. Both return `null` with no Supabase configuration and require both a project URL and a current publishable key otherwise. The transaction sample does not depend on Supabase and ships without a schema or Auth flow. `supabase/config.toml` is a CLI scaffold.
- `skills/` is the visible, versioned skill library. `.agents/skills` is a relative symlink to it so coding agents can discover the same files.

The shared `skills/` directory includes Next.js, React, EVE, TypeSafe, Workflow, shadcn, Supabase, AI SDK, AI Elements, AI Gateway, Vercel, and verification guidance. Read the relevant `SKILL.md` before changing those integrations. Skills provide workflow guidance; the installed package docs are the API source of truth:

- Next.js: `node_modules/next/dist/docs/`
- AI SDK: `node_modules/ai/docs/`
- EVE: `node_modules/eve/docs/README.md`
- Workflow SDK: `node_modules/workflow/docs/`

The checked-in dependency versions and `bun.lock` define the working stack. In particular, this starter pins Workflow SDK 5 beta; an unversioned `bun add workflow` currently resolves to Workflow 4. Read the installed docs and typecheck whenever changing versions.

## Classification behavior

Parse CSV and validate dates, amounts, direction, and row bounds in code. Jev answers closed-set semantic questions; it does not parse raw CSV or generate explanations. Keep uncertainty visible and route ambiguous transactions to review. Do not present a mock decision as a live Jev result. Show per-row queued, rules, Jev, classified, review, or failed status from actual workflow events. Never log raw uploaded rows. Do not add storage or an outbound action without documenting its retention and authorization model.

When changing a behavior, update its relevant tests. Run `bun run test`, `bun run lint`, and `bun run typecheck` before reporting the change complete. For routing, framework, dependency, EVE, Workflow, or deployment changes, also run `bun run build`. Run `bun run build:eve` when changing the agent. Use the browser to verify CSV import, mock transaction selection, live row progress, review states, and error recovery when those paths change.

## Security and deployment

The source is public; financial CSV content is sensitive. Workflow may persist inputs and status, and Gateway sends Jev evaluation state to a model provider. Use synthetic examples by default. Public deployment requires access control, reasonable request and row limits, and an explicit retention policy. `DEMO_ACCESS_TOKEN` is a minimal gate for this starter, not a substitute for user accounts and rate limits in a production service. See [docs/SECURITY.md](docs/SECURITY.md).

Deploy on Vercel. The Workflow SDK uses its local World during development and the Vercel World on Vercel. EVE runs beside Next.js through `withEve`; the Next config also composes `withWorkflow`. Document any new persistence service, authorization model, and retention policy before using it for transaction data. Optional Supabase setup is described in [docs/SUPABASE.md](docs/SUPABASE.md).

## Code conventions

Use strict TypeScript, ES modules, `import type` for type-only imports, early returns, and focused functions. Preserve user changes in the working tree. Use conventional commit prefixes. Keep API secrets server-side and read environment variables at runtime. Use Bun for all dependency and script commands.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# Contributing

Contributions that keep this starter small, clear, and runnable are welcome. Open an issue before adding a large new use case so the directory remains focused.

1. Use Node.js 24 and Bun. Run `bun install` after cloning.
2. Copy `.env.local.example` to `.env.local` for local model calls. Keep `.env.local` out of Git and do not put real transaction data or secrets in fixtures or issues.
3. Read `AGENTS.md`, the relevant `skills/<name>/SKILL.md`, and the installed package docs for APIs you change.
4. Add or update focused tests for changed behavior. Run `bun run test`, `bun run lint`, `bun run typecheck`, and `bun run build` before a pull request. Use `bun run lint:design` for UI changes.
5. Describe how the change was verified, including whether a live Gateway call and browser run were exercised. Clearly label mock-only verification.

The project is [AGPL-3.0](../LICENSE). Keep copied third-party skill notices and license files intact; see [THIRD_PARTY_NOTICES.md](../THIRD_PARTY_NOTICES.md).

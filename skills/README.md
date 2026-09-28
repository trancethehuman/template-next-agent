# Bundled agent skills

This is the visible source directory for the starter's portable coding-agent skills. `.agents/skills` is a relative symlink to this directory, so both paths expose the same folders. Most are complete copies, including their references and license files. `next-best-practices` and `web-design-guidelines` are original short guides that link to their upstream sources. Read a skill's `SKILL.md` when its work applies, then confirm APIs in the installed package documentation.

| Skill | Focus |
| --- | --- |
| `next-best-practices`, `nextjs` | Next.js App Router and version-aware patterns. |
| `vercel-react-best-practices`, `vercel-composition-patterns`, `building-components` | React performance and composable components. |
| `shadcn`, `web-design-guidelines` | UI components, design consistency, and interface review. |
| `ai-sdk`, `ai-elements`, `ai-gateway` | AI SDK APIs, AI interface components, and Gateway. |
| `eve`, `typesafe-ai`, `workflow` | Agent runtime, Jev judgments, and durable workflows. |
| `supabase` | Optional database, Auth, and Storage setup and security guidance. |
| `deployments-cicd`, `vercel-cli`, `verification` | Vercel operations and end-to-end verification. |

These are snapshots, not live documentation. Package APIs can change. `AGENTS.md` points to the version-matched docs under `node_modules/`. Third-party provenance and license notices are in [`../THIRD_PARTY_NOTICES.md`](../THIRD_PARTY_NOTICES.md), with license texts under [`LICENSES/`](LICENSES/).

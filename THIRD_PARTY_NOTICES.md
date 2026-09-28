# Third-party notices

This starter includes copies of redistributable agent-skill folders and generated UI component source. The top-level [AGPL-3.0 license](LICENSE) applies to original starter code and documentation; it does not replace the licenses or notices attached to third-party material.

| Bundled component source | Provenance | License or notice |
| --- | --- | --- |
| `components/ui/` | [shadcn/ui](https://github.com/shadcn-ui/ui) component source | MIT; see [shadcn notice](skills/LICENSES/SHADCN-MIT.txt). |
| `components/ai-elements/` | [Vercel AI Elements](https://github.com/vercel/ai-elements) component source | Apache-2.0; see [license text](skills/LICENSES/APACHE-2.0.txt). |

## Agent skills

| Material under `skills/` | Provenance | License or notice |
| --- | --- | --- |
| `ai-sdk`, `ai-elements`, `ai-gateway`, `nextjs`, `deployments-cicd`, `vercel-cli`, `verification` | [Vercel plugin](https://github.com/vercel/vercel-plugin), local plugin bundle 0.21.4 (its README identifies upstream import 0.21.0) | Apache-2.0; see [Vercel plugin notice](skills/LICENSES/VERCEL-PLUGIN-NOTICE.txt) and [license text](skills/LICENSES/APACHE-2.0.txt). |
| `vercel-react-best-practices`, `vercel-composition-patterns` | [Vercel agent skills](https://github.com/vercel-labs/agent-skills), copied from the Oatmilk repository snapshot; both skills declare MIT in their metadata | [Vercel MIT notice](skills/LICENSES/VERCEL-MIT.txt). |
| `building-components` | [Vercel components.build](https://github.com/vercel/components.build), copied from the Oatmilk repository snapshot | Apache-2.0; see [upstream notice](skills/LICENSES/VERCEL-COMPONENTS-NOTICE.txt) and [license text](skills/LICENSES/APACHE-2.0.txt). |
| `typesafe-ai` | TypeSafe AI skill, copied from the Oatmilk repository snapshot | MIT; original [license file](skills/typesafe-ai/LICENSE) is retained. |
| `eve`, `workflow` | Vercel framework guidance, copied from the Oatmilk repository snapshot | Upstream [EVE](https://github.com/vercel/eve) and [Workflow SDK](https://github.com/vercel/workflow) packages declare Apache-2.0; see [license text](skills/LICENSES/APACHE-2.0.txt). |
| `shadcn` | [shadcn/ui agent skill](https://github.com/shadcn-ui/ui/tree/main/skills/shadcn), copied from the Oatmilk repository snapshot | MIT; see [shadcn notice](skills/LICENSES/SHADCN-MIT.txt). |
| `supabase` | [Supabase agent skill](https://github.com/supabase/agent-skills/tree/main/skills/supabase), copied from the Oatmilk repository snapshot | MIT; see [Supabase notice](skills/LICENSES/SUPABASE-MIT.txt). |

`next-best-practices` and `web-design-guidelines` are original, short local guides that link to [vercel-labs/next-skills](https://github.com/vercel-labs/next-skills) and [vercel-labs/agent-skills](https://github.com/vercel-labs/agent-skills). Their upstream text is not redistributed because we could not verify a redistribution license for those specific upstream skills. These two local guides are covered by this starter's AGPL-3.0 license.

The bundled skill text may mention version-specific commands. The installed package documentation and this project's lockfile take precedence for runnable APIs. Upstream names and trademarks remain with their owners. No third-party service endorses this starter.

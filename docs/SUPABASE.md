# Optional Supabase setup

The transaction classification sample runs without Supabase. Its durable processing uses Workflow SDK, and the starter ships with no Supabase project, tables, migrations, or sign-in flow. The installed `@supabase/supabase-js` and `@supabase/ssr` packages and `lib/supabase/` helpers are for a future directory use case. `supabase/config.toml` is a CLI scaffold from `supabase init`, not an active database connection.

## Connect your own project

1. Create or choose a Supabase project. Open its Connect dialog to find the project URL and publishable key. Supabase's [Next.js quickstart](https://supabase.com/docs/guides/getting-started/quickstarts/nextjs) uses the same environment names.
2. Copy `.env.local.example` to the Git-ignored `.env.local`. Fill in both `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`. The helper accepts a current `sb_publishable_...` key. Leave both empty when Supabase is unused. Restart `bun run dev` after changing environment values.
3. For deployment, set both names in the intended Vercel environment and deploy again. Environment changes need a new deployment to reach running code.
4. Read `skills/supabase/SKILL.md` and the current [Supabase SSR documentation](https://supabase.com/docs/guides/auth/server-side) before adding Auth or a database-backed use case.

The `NEXT_PUBLIC_` prefix exposes these values to browser code. A Supabase publishable key is designed for that use, but it is not a user authorization mechanism. Never put a Supabase secret or legacy `service_role` key in these variables. See [Supabase API keys](https://supabase.com/docs/guides/getting-started/api-keys).

When a new feature needs a client, call `createBrowserSupabaseClient()` from `lib/supabase/client.ts` in a Client Component or `await createServerSupabaseClient()` from `lib/supabase/server.ts` in a server context. Both return `null` when both variables are unset and throw if only one is set or the values are invalid. They create no client at module import time. Before implementing sign-in, add and verify the cookie refresh/proxy flow required by the current Supabase SSR guide; these helpers alone do not provide a complete Auth integration.

## Before storing user data

Define who owns each row and how they can read or change it. Enable Row Level Security on every exposed table, set grants and policies for the actual access model, and test both allowed and denied operations. Follow Supabase's [RLS guide](https://supabase.com/docs/guides/database/postgres/row-level-security). Add a reviewed migration and retention policy for any financial data. The starter's `DEMO_ACCESS_TOKEN` does not provide Supabase row ownership.

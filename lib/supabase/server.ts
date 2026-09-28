import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

import { getSupabaseConfig } from "./config";
import type { SupabaseEnvironment } from "./config";

export async function createServerSupabaseClient(
  environment?: SupabaseEnvironment,
) {
  const config = getSupabaseConfig(environment);
  if (!config) {
    return null;
  }

  const cookieStore = await cookies();

  return createServerClient(config.url, config.publishableKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options);
          }
        } catch {
          return;
        }
      },
    },
  });
}

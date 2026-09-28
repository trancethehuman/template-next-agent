"use client";

import { createBrowserClient } from "@supabase/ssr";

import { getSupabaseConfig } from "./config";
import type { SupabaseEnvironment } from "./config";

export function createBrowserSupabaseClient(environment?: SupabaseEnvironment) {
  const config = getSupabaseConfig(environment);
  if (!config) {
    return null;
  }

  return createBrowserClient(config.url, config.publishableKey);
}

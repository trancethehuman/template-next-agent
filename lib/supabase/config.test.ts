import { describe, expect, test } from "bun:test";

import { createBrowserSupabaseClient } from "./client";
import { getSupabaseConfig } from "./config";
import { createServerSupabaseClient } from "./server";

describe("optional Supabase configuration", () => {
  test("returns null when both public values are absent", async () => {
    expect(getSupabaseConfig({})).toBeNull();
    expect(createBrowserSupabaseClient({})).toBeNull();
    expect(await createServerSupabaseClient({})).toBeNull();
  });

  test("accepts a URL and publishable key", () => {
    const environment = {
      NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co/",
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test_key",
    };

    expect(getSupabaseConfig(environment)).toEqual({
      url: "https://example.supabase.co",
      publishableKey: "sb_publishable_test_key",
    });
    expect(createBrowserSupabaseClient(environment)).not.toBeNull();
  });

  test("rejects incomplete or invalid configuration", () => {
    expect(() =>
      getSupabaseConfig({ NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co" }),
    ).toThrow("Set both NEXT_PUBLIC_SUPABASE_URL");
    expect(() =>
      getSupabaseConfig({
        NEXT_PUBLIC_SUPABASE_URL: "file:///tmp/project",
        NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test_key",
      }),
    ).toThrow("must be a valid HTTP(S) URL");
    expect(() =>
      getSupabaseConfig({
        NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co",
        NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "service_role_key",
      }),
    ).toThrow("must be a Supabase publishable key");
  });
});

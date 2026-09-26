import { describe, it, expect, afterEach, vi } from "vitest";
import { isCloudConfigured, getSupabaseClient, __setSupabaseClientForTests } from "./client.js";
import { CloudNotConfiguredError } from "./errors.js";

describe("cloud/client", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    __setSupabaseClientForTests(null);
  });

  it("isCloudConfigured() est faux si les variables d'environnement sont absentes", () => {
    vi.stubEnv("VITE_SUPABASE_URL", "");
    vi.stubEnv("VITE_SUPABASE_ANON_KEY", "");
    expect(isCloudConfigured()).toBe(false);
  });

  it("isCloudConfigured() est faux si une seule des deux variables est renseignée", () => {
    vi.stubEnv("VITE_SUPABASE_URL", "https://example.supabase.co");
    vi.stubEnv("VITE_SUPABASE_ANON_KEY", "");
    expect(isCloudConfigured()).toBe(false);
  });

  it("isCloudConfigured() est vrai si les deux variables sont renseignées", () => {
    vi.stubEnv("VITE_SUPABASE_URL", "https://example.supabase.co");
    vi.stubEnv("VITE_SUPABASE_ANON_KEY", "test-anon-key");
    expect(isCloudConfigured()).toBe(true);
  });

  it("getSupabaseClient() lève CloudNotConfiguredError si non configuré", () => {
    vi.stubEnv("VITE_SUPABASE_URL", "");
    vi.stubEnv("VITE_SUPABASE_ANON_KEY", "");
    expect(() => getSupabaseClient()).toThrow(CloudNotConfiguredError);
  });

  it("getSupabaseClient() renvoie la même instance mémorisée pour une config identique", () => {
    vi.stubEnv("VITE_SUPABASE_URL", "https://example.supabase.co");
    vi.stubEnv("VITE_SUPABASE_ANON_KEY", "test-anon-key");
    const a = getSupabaseClient();
    const b = getSupabaseClient();
    expect(a).toBe(b);
  });

  it("__setSupabaseClientForTests() prend le dessus même sans configuration réelle", () => {
    const fake = { fake: true };
    __setSupabaseClientForTests(fake);
    expect(getSupabaseClient()).toBe(fake);
  });
});

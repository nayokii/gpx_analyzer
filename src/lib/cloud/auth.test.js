import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { __setSupabaseClientForTests } from "./client.js";
import { getCurrentUser, onAuthStateChange, signUp, signIn, signOut } from "./auth.js";
import { CloudAuthError } from "./errors.js";
import { createFakeSupabaseBackend } from "./tests/fakeSupabase.js";

describe("cloud/auth", () => {
  let backend;

  beforeEach(() => {
    backend = createFakeSupabaseBackend();
    __setSupabaseClientForTests(backend.client);
  });

  afterEach(() => {
    __setSupabaseClientForTests(null);
  });

  it("getCurrentUser() renvoie null quand personne n'est connecté", async () => {
    expect(await getCurrentUser()).toBeNull();
  });

  it("signUp() crée un compte et connecte la session", async () => {
    const user = await signUp({ email: "a@example.com", password: "password123" });
    expect(user.email).toBe("a@example.com");
    expect((await getCurrentUser()).email).toBe("a@example.com");
  });

  it("signUp() avec un email déjà utilisé lève CloudAuthError", async () => {
    await signUp({ email: "a@example.com", password: "password123" });
    await expect(signUp({ email: "a@example.com", password: "autreChose1" })).rejects.toThrow(CloudAuthError);
  });

  it("signIn() avec de bons identifiants connecte la session", async () => {
    await signUp({ email: "a@example.com", password: "password123" });
    await signOut();
    expect(await getCurrentUser()).toBeNull();

    const user = await signIn({ email: "a@example.com", password: "password123" });
    expect(user.email).toBe("a@example.com");
    expect((await getCurrentUser()).email).toBe("a@example.com");
  });

  it("signIn() avec un mauvais mot de passe lève CloudAuthError sans connecter de session", async () => {
    await signUp({ email: "a@example.com", password: "password123" });
    await signOut();

    await expect(signIn({ email: "a@example.com", password: "mauvais-mdp" })).rejects.toThrow(CloudAuthError);
    expect(await getCurrentUser()).toBeNull();
  });

  it("signOut() déconnecte la session", async () => {
    await signUp({ email: "a@example.com", password: "password123" });
    await signOut();
    expect(await getCurrentUser()).toBeNull();
  });

  it("onAuthStateChange() notifie à chaque connexion/déconnexion, et le désabonnement arrête les notifications", async () => {
    const events = [];
    const unsubscribe = onAuthStateChange((user) => events.push(user ? user.email : null));

    await signUp({ email: "a@example.com", password: "password123" });
    await signOut();
    expect(events).toEqual(["a@example.com", null]);

    unsubscribe();
    await signIn({ email: "a@example.com", password: "password123" });
    expect(events).toEqual(["a@example.com", null]); // aucune notification supplémentaire après désabonnement
  });
});

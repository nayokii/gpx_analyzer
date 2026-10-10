import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { __setSupabaseClientForTests } from "./client.js";
import {
  getCurrentUser, onAuthStateChange, signUp, signIn, signOut,
  requestPasswordReset, getRecoveryRedirectUrl, parseRecoveryHash, beginPasswordRecovery, updatePassword, onPasswordRecovery,
} from "./auth.js";
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

describe("cloud/auth — récupération de mot de passe", () => {
  let backend;

  beforeEach(() => {
    backend = createFakeSupabaseBackend();
    __setSupabaseClientForTests(backend.client);
  });

  afterEach(() => {
    __setSupabaseClientForTests(null);
  });

  it("requestPasswordReset() demande le mail avec redirectTo = origine de l'app", async () => {
    await requestPasswordReset("  a@example.com ");
    expect(backend.resetRequests).toEqual([{ email: "a@example.com", redirectTo: `${window.location.origin}/` }]);
    expect(getRecoveryRedirectUrl()).toBe(`${window.location.origin}/`);
  });

  it("requestPasswordReset() refuse une adresse vide et traduit la limite d'envoi", async () => {
    await expect(requestPasswordReset("   ")).rejects.toThrow(/adresse e-mail/);
    await expect(requestPasswordReset("limite@example.com")).rejects.toThrow(/Trop de demandes/);
  });

  it("parseRecoveryHash() reconnaît un lien de récupération, un lien expiré, et ignore le reste", () => {
    expect(parseRecoveryHash("")).toEqual({ status: "none" });
    expect(parseRecoveryHash("#foo=bar")).toEqual({ status: "none" });
    expect(parseRecoveryHash("#access_token=a&refresh_token=r&type=signup")).toEqual({ status: "none" });
    expect(parseRecoveryHash("#access_token=a&refresh_token=r&type=recovery")).toEqual({ status: "recovery", accessToken: "a", refreshToken: "r" });
    const expired = parseRecoveryHash("#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired");
    expect(expired.status).toBe("error");
    expect(expired.message).toMatch(/expiré/);
  });

  it("beginPasswordRecovery() établit la session de récupération d'un lien valide", async () => {
    await signUp({ email: "a@example.com", password: "password123" });
    await signOut();
    const hash = backend.makeRecoveryHash("a@example.com");

    const result = await beginPasswordRecovery(hash);
    expect(result).toEqual({ status: "ready", email: "a@example.com" });
    expect((await getCurrentUser()).email).toBe("a@example.com");
  });

  it("beginPasswordRecovery() signale un jeton invalide sans ouvrir de session, et ne fait rien sans lien", async () => {
    expect(await beginPasswordRecovery("")).toEqual({ status: "none" });
    const result = await beginPasswordRecovery("#access_token=faux&refresh_token=faux&type=recovery");
    expect(result.status).toBe("error");
    expect(await getCurrentUser()).toBeNull();
  });

  it("updatePassword() enregistre le nouveau mot de passe : l'ancien ne fonctionne plus, le nouveau oui", async () => {
    await signUp({ email: "a@example.com", password: "ancien-mdp" });
    await signOut();
    await beginPasswordRecovery(backend.makeRecoveryHash("a@example.com"));

    await updatePassword("nouveau-mdp");
    await signOut();
    await expect(signIn({ email: "a@example.com", password: "ancien-mdp" })).rejects.toThrow(CloudAuthError);
    expect((await signIn({ email: "a@example.com", password: "nouveau-mdp" })).email).toBe("a@example.com");
  });

  it("updatePassword() refuse un mot de passe trop court, identique à l'ancien, ou sans session de récupération", async () => {
    await signUp({ email: "a@example.com", password: "ancien-mdp" });
    await expect(updatePassword("123")).rejects.toThrow(/au moins 6/);
    await expect(updatePassword("ancien-mdp")).rejects.toThrow(/différent de l'ancien/);
    await signOut();
    await expect(updatePassword("nouveau-mdp")).rejects.toThrow(CloudAuthError);
  });

  it("onPasswordRecovery() n'appelle le callback que pour l'événement PASSWORD_RECOVERY", async () => {
    const seen = [];
    const unsubscribe = onPasswordRecovery((user) => seen.push(user ? user.email : null));
    await signUp({ email: "a@example.com", password: "password123" }); // événement ordinaire : ignoré
    expect(seen).toEqual([]);
    unsubscribe();
  });
});

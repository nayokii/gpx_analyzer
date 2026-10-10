import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, cleanup, screen, fireEvent, waitFor } from "@testing-library/react";

import { PasswordRecoveryView } from "./PasswordRecoveryView.jsx";
import { __setSupabaseClientForTests } from "../lib/cloud/client.js";
import { beginPasswordRecovery, signIn, signOut, signUp } from "../lib/cloud/index.js";
import { createFakeSupabaseBackend } from "../lib/cloud/tests/fakeSupabase.js";

let backend;

beforeEach(async () => {
  backend = createFakeSupabaseBackend();
  __setSupabaseClientForTests(backend.client);
  await signUp({ email: "a@example.com", password: "ancien-mdp" });
  await signOut();
  // L'écran suppose que GPXAnalyzer a déjà établi la session du lien (voir beginPasswordRecovery).
  await beginPasswordRecovery(backend.makeRecoveryHash("a@example.com"));
});

afterEach(() => {
  cleanup();
  __setSupabaseClientForTests(null);
});

function fill(label, value) {
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
}

describe("PasswordRecoveryView", () => {
  it("phase « checking » : indique la vérification du lien, sans formulaire", () => {
    render(<PasswordRecoveryView phase="checking" onDone={() => {}} />);
    expect(screen.getByText(/Vérification du lien/)).toBeTruthy();
    expect(screen.queryByLabelText("Nouveau mot de passe")).toBeNull();
  });

  it("phase « error » : affiche le message du lien expiré, sans formulaire, et permet de quitter", () => {
    const onDone = vi.fn();
    render(<PasswordRecoveryView phase="error" error="Ce lien a expiré ou a déjà été utilisé." onDone={onDone} />);
    expect(screen.getByRole("alert").textContent).toMatch(/expiré/);
    expect(screen.queryByLabelText("Nouveau mot de passe")).toBeNull();
    fireEvent.click(screen.getByText("Retour à l'application"));
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it("phase « ready » : affiche le compte concerné et les deux champs", () => {
    render(<PasswordRecoveryView phase="ready" email="a@example.com" onDone={() => {}} />);
    expect(screen.getByText(/Compte : a@example.com/)).toBeTruthy();
    expect(screen.getByLabelText("Nouveau mot de passe")).toBeTruthy();
    expect(screen.getByLabelText("Confirmer le mot de passe")).toBeTruthy();
  });

  it("refuse deux mots de passe différents, sans appeler Supabase", async () => {
    render(<PasswordRecoveryView phase="ready" email="a@example.com" onDone={() => {}} />);
    fill("Nouveau mot de passe", "nouveau-mdp");
    fill("Confirmer le mot de passe", "autre-chose");
    fireEvent.click(screen.getByText("Enregistrer le mot de passe"));
    expect((await screen.findByRole("alert")).textContent).toMatch(/pas identiques/);
    // L'ancien mot de passe fonctionne toujours : rien n'a été enregistré.
    await signOut();
    expect((await signIn({ email: "a@example.com", password: "ancien-mdp" })).email).toBe("a@example.com");
  });

  it("affiche l'erreur renvoyée par Supabase (nouveau mot de passe identique à l'ancien)", async () => {
    render(<PasswordRecoveryView phase="ready" email="a@example.com" onDone={() => {}} />);
    fill("Nouveau mot de passe", "ancien-mdp");
    fill("Confirmer le mot de passe", "ancien-mdp");
    fireEvent.click(screen.getByText("Enregistrer le mot de passe"));
    expect((await screen.findByRole("alert")).textContent).toMatch(/différent de l'ancien/);
  });

  it("enregistre le nouveau mot de passe, confirme la réussite, puis « Continuer » quitte l'écran", async () => {
    const onDone = vi.fn();
    render(<PasswordRecoveryView phase="ready" email="a@example.com" onDone={onDone} />);
    fill("Nouveau mot de passe", "nouveau-mdp");
    fill("Confirmer le mot de passe", "nouveau-mdp");
    fireEvent.click(screen.getByText("Enregistrer le mot de passe"));

    await waitFor(() => expect(screen.getByRole("status").textContent).toMatch(/Mot de passe modifié/));
    expect(screen.queryByLabelText("Nouveau mot de passe")).toBeNull();

    // Le nouveau mot de passe fonctionne réellement ; l'ancien non.
    await signOut();
    await expect(signIn({ email: "a@example.com", password: "ancien-mdp" })).rejects.toThrow();
    expect((await signIn({ email: "a@example.com", password: "nouveau-mdp" })).email).toBe("a@example.com");

    fireEvent.click(screen.getByText("Continuer"));
    expect(onDone).toHaveBeenCalledTimes(1);
  });
});

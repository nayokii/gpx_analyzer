/**
 * Tests de navigation de l'application (Phase "IA & navigation"). Ne
 * revérifie PAS l'exactitude des calculs métier (profil/progression/
 * archétype) — déjà couverte en profondeur par ProfileView.test.jsx/
 * AlterEgoView.test.jsx/ArchetypeView.test.jsx/HomeView.test.jsx, chacun
 * comparant l'affichage aux moteurs appelés directement. Ce fichier vérifie
 * uniquement que la navigation principale persistante (AppNav) mène
 * réellement à chaque section, que le contexte "sortie ouverte" est
 * distinct de la navigation globale, et que le mode démo ne pollue rien.
 *
 * Sans dossier de stockage connecté (impossible à simuler ici sans mocker
 * l'API File System Access — voir ProfileView.test.jsx pour les scénarios
 * avec stockage réel, testés au niveau du composant de vue directement, qui
 * accepte `storage` en prop) : chaque section retombe sur son état vide/non
 * connecté, ce qui suffit à vérifier qu'on y accède bien.
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, cleanup, screen, fireEvent, waitFor, within } from "@testing-library/react";
import GPXAnalyzer from "./GPXAnalyzer.jsx";
import { stubResizeObserver } from "./components/testResizeObserverMock.js";
import { __setSupabaseClientForTests } from "./lib/cloud/client.js";
import { __resetSyncCoordinatorForTests } from "./lib/storage/activityRepository.js";
import { createFakeSupabaseBackend } from "./lib/cloud/tests/fakeSupabase.js";
import { listQueuedOperations, clearQueue } from "./lib/storage/syncQueue.js";

stubResizeObserver();

// Leaflet ne fonctionne pas dans jsdom (pas de vrai layout/canvas) — préexistant,
// sans rapport avec cette phase. Le résumé d'une sortie ouverte (mode "dashboard")
// affiche la carte par défaut ; on la neutralise ici pour tester la navigation
// sans dépendre du rendu cartographique, déjà hors du périmètre de ce fichier.
vi.mock("./components/MapView.jsx", () => ({ MapView: () => null }));

afterEach(async () => {
  cleanup();
  // Laisse une "tick" à un repository.sync() encore en vol (Phase 11C,
  // déclenché automatiquement au login/mount, voir useActivityRepository.js)
  // pour se terminer contre SON PROPRE backend simulé avant de le neutraliser.
  await new Promise((resolve) => setTimeout(resolve, 0));
  vi.unstubAllEnvs();
  __setSupabaseClientForTests(null);
  __resetSyncCoordinatorForTests();
  clearQueue();
});

describe("Navigation principale — 6 destinations toujours accessibles", () => {
  it("Accueil est l'écran de démarrage", async () => {
    render(<GPXAnalyzer />);
    expect(await screen.findByText(/Glissez-déposez votre fichier/)).toBeTruthy();
  });

  it("navigue directement vers Sorties (Historique) sans passer par un lien 'Voir mon historique'", async () => {
    render(<GPXAnalyzer />);
    await screen.findByText(/Glissez-déposez votre fichier/);
    fireEvent.click(screen.getAllByText("Sorties")[0]);
    expect(await screen.findByRole("heading", { name: "Historique", level: 1 })).toBeTruthy();
  });

  it("navigue directement vers Profil depuis la navigation principale", async () => {
    render(<GPXAnalyzer />);
    await screen.findByText(/Glissez-déposez votre fichier/);
    fireEvent.click(screen.getAllByText("Profil")[0]);
    expect(await screen.findByRole("heading", { name: "Mon profil cycliste", level: 1 })).toBeTruthy();
  });

  it("navigue directement vers Alter Ego depuis la navigation principale", async () => {
    render(<GPXAnalyzer />);
    await screen.findByText(/Glissez-déposez votre fichier/);
    fireEvent.click(screen.getAllByText("Alter Ego")[0]);
    expect(await screen.findByRole("heading", { name: "Alter Ego", level: 1 })).toBeTruthy();
  });

  it("navigue directement vers Archétype depuis la navigation principale", async () => {
    render(<GPXAnalyzer />);
    await screen.findByText(/Glissez-déposez votre fichier/);
    fireEvent.click(screen.getAllByText("Archétype")[0]);
    expect(await screen.findByRole("heading", { name: "Archétype", level: 1 })).toBeTruthy();
  });

  it("navigue directement vers Tour depuis la navigation principale", async () => {
    render(<GPXAnalyzer />);
    await screen.findByText(/Glissez-déposez votre fichier/);
    fireEvent.click(screen.getAllByText("Tour")[0]);
    expect(await screen.findByRole("heading", { name: "Tour Simulator", level: 1 })).toBeTruthy();
  });

  it("revient à Accueil depuis n'importe quelle section", async () => {
    render(<GPXAnalyzer />);
    await screen.findByText(/Glissez-déposez votre fichier/);
    fireEvent.click(screen.getAllByText("Archétype")[0]);
    await screen.findByRole("heading", { name: "Archétype", level: 1 });
    fireEvent.click(screen.getAllByText("Dashboard")[0]);
    expect(await screen.findByText(/Glissez-déposez votre fichier/)).toBeTruthy();
  });
});

describe("Contexte 'sortie ouverte' distinct de la navigation globale", () => {
  it("affiche un fil d'Ariane contextuel en mode analyse, séparé de la navigation principale, avec un retour vers Sorties", async () => {
    render(<GPXAnalyzer />);
    await screen.findByText(/Glissez-déposez votre fichier/);
    fireEvent.click(screen.getByText(/Voir un exemple avec des données de démonstration/));

    // Toujours dans l'analyse : le fil d'Ariane du shell nomme la sortie ouverte, distinct de la navigation principale.
    const crumbs = document.querySelector(".gpx-shell-crumbs");
    expect(within(crumbs).getByText(/Analyse — /).getAttribute("aria-current")).toBe("page");

    // Revenir vers Sorties depuis le fil d'Ariane (pas depuis la nav globale) ramène à l'historique.
    fireEvent.click(within(crumbs).getByRole("button", { name: "Mes sorties" }));
    expect(await screen.findByRole("heading", { name: "Historique", level: 1 })).toBeTruthy();
  });
});

describe("Détail d'une sortie : design system et neuf onglets", () => {
  it("porte la classe .gpx-ds (conventions du cockpit) et garde ses neuf onglets, tous activables", async () => {
    render(<GPXAnalyzer />);
    await screen.findByText(/Glissez-déposez votre fichier/);
    fireEvent.click(screen.getByText(/Voir un exemple avec des données de démonstration/));
    await screen.findByText("Sortie de démonstration");

    const root = document.querySelector(".gpx-view-analyse");
    expect(root.classList.contains("gpx-ds")).toBe(true);
    const labels = ["Résumé", "Analytique", "Carte", "Performance", "Montées", "Technique", "Graphiques", "Splits", "Paramètres"];
    const tabs = Array.from(document.querySelectorAll(".gpx-tab")).map((t) => t.textContent);
    expect(tabs).toEqual(labels);

    for (const label of labels) {
      const tab = Array.from(document.querySelectorAll(".gpx-tab")).find((t) => t.textContent === label);
      expect(tab.disabled).toBe(false);
      fireEvent.click(tab);
      await waitFor(() => expect(Array.from(document.querySelectorAll(".gpx-tab")).find((t) => t.textContent === label).className).toContain("active"));
      expect(document.querySelector(".gpx-view-analyse.gpx-ds")).toBeTruthy();
    }
  });

  it("ne duplique pas le titre fourni par le shell : un seul h1 (celui de la sortie), le fil d'Ariane n'est pas un titre", async () => {
    render(<GPXAnalyzer />);
    await screen.findByText(/Glissez-déposez votre fichier/);
    fireEvent.click(screen.getByText(/Voir un exemple avec des données de démonstration/));
    await screen.findByText("Sortie de démonstration");
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    expect(document.querySelector(".gpx-shell-crumbs h1, .gpx-shell-header h1")).toBeNull();
  });
});

describe("Mode démo — isolation", () => {
  it("charger la démo ouvre l'analyse, mais ne pollue aucune des sections globales", async () => {
    render(<GPXAnalyzer />);
    await screen.findByText(/Glissez-déposez votre fichier/);
    fireEvent.click(screen.getByText(/Voir un exemple avec des données de démonstration/));
    expect(await screen.findByText("Sortie de démonstration")).toBeTruthy();

    fireEvent.click(screen.getAllByText("Profil")[0]);
    expect(await screen.findByRole("heading", { name: "Mon profil cycliste", level: 1 })).toBeTruthy();
    // Aucune trace de la sortie démo (nom/distance) sur la page Profil : elle ne lit que le stockage persisté.
    expect(screen.queryByText("Sortie de démonstration")).toBeNull();

    fireEvent.click(screen.getAllByText("Alter Ego")[0]);
    expect(await screen.findByRole("heading", { name: "Alter Ego", level: 1 })).toBeTruthy();
    expect(screen.queryByText("Sortie de démonstration")).toBeNull();

    fireEvent.click(screen.getAllByText("Tour")[0]);
    expect(await screen.findByRole("heading", { name: "Tour Simulator", level: 1 })).toBeTruthy();
    expect(screen.queryByText("Sortie de démonstration")).toBeNull();
  });

  it("(Phase 11C §22) une sortie démo n'est jamais envoyée au cloud, même avec un compte cloud connecté", async () => {
    vi.stubEnv("VITE_SUPABASE_URL", "https://example.supabase.co");
    vi.stubEnv("VITE_SUPABASE_ANON_KEY", "test-anon-key");
    const backend = createFakeSupabaseBackend();
    __setSupabaseClientForTests(backend.client);
    await backend.signUpAndLogin("demo-isolation@example.com");

    render(<GPXAnalyzer />);
    await screen.findByText(/Glissez-déposez votre fichier/);
    fireEvent.click(screen.getByText(/Voir un exemple avec des données de démonstration/));
    await screen.findByText("Sortie de démonstration");

    // Laisse le temps à un éventuel appel réseau (il ne devrait jamais y en avoir).
    await new Promise((resolve) => setTimeout(resolve, 20));

    const { data: cloudRows } = await backend.client.from("activities").select();
    expect(cloudRows).toEqual([]);
    expect(listQueuedOperations()).toEqual([]);
  });
});

describe("Navigation : structure responsive", () => {
  it("un seul shell pour toutes les vues : barre latérale + barre basse mobile, sans barre haute (le choix d'affichage est purement CSS)", async () => {
    render(<GPXAnalyzer />);
    await screen.findByText(/Glissez-déposez votre fichier/);
    expect(screen.getAllByText("Profil").length).toBeGreaterThanOrEqual(1);
    expect(document.querySelector(".gpx-sidebar")).toBeTruthy();
    expect(document.querySelector(".gpx-bottomnav")).toBeTruthy();
    expect(document.querySelector(".gpx-shell-header")).toBeTruthy();
    expect(document.querySelector(".gpx-appnav-top")).toBeNull();
    // Le thème est global (lib/theme.js) : l'accueil ne force plus le sien.
    expect(["light", "dark"]).toContain(document.documentElement.getAttribute("data-theme"));
  });

  it("la même coque entoure chaque vue, et le thème choisi reste identique d'une route à l'autre", async () => {
    render(<GPXAnalyzer />);
    await screen.findByText(/Glissez-déposez votre fichier/);
    fireEvent.click(screen.getByRole("radio", { name: "Sombre" }));
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");

    const sidebar = () => document.querySelector(".gpx-sidebar");
    const routes = [
      ["Mes sorties", "Historique"], ["Activités", null], ["Coach", null], ["Profil", "Mon profil cycliste"],
      ["Archétype", "Archétype"], ["Tour", "Tour Simulator"], ["Alter Ego", "Alter Ego"], ["Sources de données", null],
    ];
    for (const [label, heading] of routes) {
      fireEvent.click(within(sidebar()).getByRole("button", { name: label }));
      if (heading) await screen.findByRole("heading", { name: heading, level: 1 });
      await waitFor(() => expect(within(sidebar()).getByRole("button", { name: label }).getAttribute("aria-current")).toBe("page"));
      expect(document.querySelectorAll(".gpx-sidebar")).toHaveLength(1);
      expect(document.querySelector(".gpx-shell-header")).toBeTruthy();
      expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
      expect(screen.getByRole("radio", { name: "Sombre" }).getAttribute("aria-checked")).toBe("true");
    }
    fireEvent.click(within(sidebar()).getByRole("button", { name: "Dashboard" }));
    expect(await screen.findByText(/Glissez-déposez votre fichier/)).toBeTruthy();
  });

  it("depuis le menu « Plus » du mobile, toutes les destinations secondaires mènent à leur vue", async () => {
    render(<GPXAnalyzer />);
    await screen.findByText(/Glissez-déposez votre fichier/);
    fireEvent.click(screen.getByRole("button", { name: "Plus de destinations" }));
    fireEvent.click(within(screen.getByRole("group", { name: "Autres destinations" })).getByText("Profil"));
    expect(await screen.findByRole("heading", { name: "Mon profil cycliste", level: 1 })).toBeTruthy();
    expect(screen.queryByRole("group", { name: "Autres destinations" })).toBeNull();
  });
});

describe("Récupération de mot de passe — lien reçu par e-mail", () => {
  afterEach(() => {
    window.history.replaceState(null, "", "/");
  });

  it("un lien de récupération valide ouvre « Nouveau mot de passe », nettoie l'URL et permet de changer le mot de passe", async () => {
    const backend = createFakeSupabaseBackend();
    __setSupabaseClientForTests(backend.client);
    await backend.signUpAndLogin("a@example.com", "ancien-mdp");
    backend.setSessionUser(null);
    window.history.replaceState(null, "", "/" + backend.makeRecoveryHash("a@example.com"));

    render(<GPXAnalyzer />);

    // Pas d'écran d'accueil : on arrive directement sur la récupération.
    expect(screen.getByRole("heading", { name: "Nouveau mot de passe" })).toBeTruthy();
    expect(screen.queryByText(/Glissez-déposez votre fichier/)).toBeNull();

    const field = await screen.findByLabelText("Nouveau mot de passe", {}, { timeout: 3000 });
    expect(window.location.hash).toBe(""); // jetons retirés de la barre d'adresse
    expect(screen.getByText(/Compte : a@example.com/)).toBeTruthy();

    fireEvent.change(field, { target: { value: "nouveau-mdp" } });
    fireEvent.change(screen.getByLabelText("Confirmer le mot de passe"), { target: { value: "nouveau-mdp" } });
    fireEvent.click(screen.getByText("Enregistrer le mot de passe"));
    await waitFor(() => expect(screen.getByText(/Mot de passe modifié/)).toBeTruthy());

    fireEvent.click(screen.getByText("Continuer"));
    expect(await screen.findByText(/Glissez-déposez votre fichier/)).toBeTruthy();
  });

  it("un lien expiré affiche l'erreur et aucun formulaire", async () => {
    window.history.replaceState(null, "", "/#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired");
    render(<GPXAnalyzer />);
    expect(await screen.findByText(/expiré/)).toBeTruthy();
    expect(screen.queryByLabelText("Nouveau mot de passe")).toBeNull();
    await waitFor(() => expect(window.location.hash).toBe(""));
  });

  it("sans lien de récupération, l'application démarre normalement sur l'accueil", async () => {
    window.history.replaceState(null, "", "/#autre");
    render(<GPXAnalyzer />);
    expect(await screen.findByText(/Glissez-déposez votre fichier/)).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "Nouveau mot de passe" })).toBeNull();
  });
});

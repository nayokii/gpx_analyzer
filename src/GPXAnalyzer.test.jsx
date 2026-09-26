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
    fireEvent.click(screen.getAllByText("Accueil")[0]);
    expect(await screen.findByText(/Glissez-déposez votre fichier/)).toBeTruthy();
  });
});

describe("Contexte 'sortie ouverte' distinct de la navigation globale", () => {
  it("affiche une bande contextuelle en mode analyse, séparée de la navigation principale, avec un retour vers Sorties", async () => {
    render(<GPXAnalyzer />);
    await screen.findByText(/Glissez-déposez votre fichier/);
    fireEvent.click(screen.getByText(/Voir un exemple avec des données de démonstration/));

    // Toujours dans l'analyse : la bande contextuelle nomme la sortie ouverte.
    await waitFor(() => expect(screen.getByText(/Analyse — /)).toBeTruthy());

    // Revenir vers Sorties depuis la bande contextuelle (pas depuis la nav globale) ramène à l'historique.
    const contextStrip = document.querySelector(".gpx-context-strip");
    fireEvent.click(within(contextStrip).getByText("Sorties"));
    expect(await screen.findByRole("heading", { name: "Historique", level: 1 })).toBeTruthy();
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

describe("Navigation — structure responsive", () => {
  it("les deux jeux de navigation (haut desktop, bas mobile) existent dans le DOM — le choix d'affichage est purement CSS", async () => {
    render(<GPXAnalyzer />);
    await screen.findByText(/Glissez-déposez votre fichier/);
    expect(screen.getAllByText("Profil").length).toBeGreaterThanOrEqual(2);
    expect(document.querySelector(".gpx-appnav-top")).toBeTruthy();
    expect(document.querySelector(".gpx-appnav-bottom")).toBeTruthy();
  });
});

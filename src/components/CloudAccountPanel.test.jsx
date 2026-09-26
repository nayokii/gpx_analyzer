import { describe, it, expect, afterEach, vi } from "vitest";
import { render, cleanup, screen, fireEvent, waitFor } from "@testing-library/react";

import { CloudAccountPanel } from "./CloudAccountPanel.jsx";
import { __setSupabaseClientForTests } from "../lib/cloud/client.js";
import { __resetSyncCoordinatorForTests } from "../lib/storage/activityRepository.js";
import { createFakeSupabaseBackend } from "../lib/cloud/tests/fakeSupabase.js";
import { uploadActivity as cloudUploadActivity } from "../lib/cloud/index.js";
import { MemoryDirectoryHandle } from "../lib/storage/testFsHandle.js";
import { saveActivity } from "../lib/storage/activityStore.js";
import { createEmptyActivity } from "../lib/types.js";
import { enqueueUpload, clearQueue } from "../lib/storage/syncQueue.js";

const DISCONNECTED_STORAGE = { status: "disconnected", rootHandle: null, dirName: null };

function makeActivity(overrides = {}) {
  const a = createEmptyActivity();
  return {
    ...a,
    id: overrides.id || "a1",
    name: "Sortie test",
    date: "2026-09-20T08:00:00.000Z",
    distance: 30,
    duration: 5400,
    flags: { ...a.flags, hasGps: true },
    source: { type: "gpx", originalFilename: "sortie.gpx", storedFilename: null, sourceId: null, athleteId: null },
    ...overrides,
  };
}

afterEach(async () => {
  cleanup();
  // Phase 11C : le login déclenche un repository.sync() en arrière-plan
  // (voir useActivityRepository.js), jamais attendu par le composant. Le
  // laisser une "tick" pour se terminer contre SON PROPRE backend simulé
  // avant de neutraliser le client cloud ci-dessous évite qu'une synchro
  // encore en vol d'un test précédent ne s'exécute par erreur contre le
  // backend fraîchement configuré du test SUIVANT.
  await new Promise((resolve) => setTimeout(resolve, 0));
  vi.unstubAllEnvs();
  __setSupabaseClientForTests(null);
  __resetSyncCoordinatorForTests();
  clearQueue();
  Object.defineProperty(window.navigator, "onLine", { value: true, configurable: true });
});

describe("CloudAccountPanel — non configuré / démo", () => {
  it("signale une configuration cloud absente sans planter", () => {
    vi.stubEnv("VITE_SUPABASE_URL", "");
    vi.stubEnv("VITE_SUPABASE_ANON_KEY", "");
    render(<CloudAccountPanel storage={DISCONNECTED_STORAGE} isDemo={false} />);
    expect(screen.getByText(/Cloud non configuré/)).toBeTruthy();
  });

  it("désactive toute action cloud en mode démo, même configuré", () => {
    vi.stubEnv("VITE_SUPABASE_URL", "https://example.supabase.co");
    vi.stubEnv("VITE_SUPABASE_ANON_KEY", "test-anon-key");
    render(<CloudAccountPanel storage={DISCONNECTED_STORAGE} isDemo />);
    expect(screen.getByText(/Indisponible en mode démo/)).toBeTruthy();
    expect(screen.queryByText("Créer un compte")).toBeNull();
  });
});

describe("CloudAccountPanel — non connecté", () => {
  it("affiche le formulaire de connexion quand le cloud est configuré mais aucun compte connecté", async () => {
    vi.stubEnv("VITE_SUPABASE_URL", "https://example.supabase.co");
    vi.stubEnv("VITE_SUPABASE_ANON_KEY", "test-anon-key");
    const backend = createFakeSupabaseBackend();
    __setSupabaseClientForTests(backend.client);

    render(<CloudAccountPanel storage={DISCONNECTED_STORAGE} isDemo={false} />);
    expect(await screen.findByLabelText("Email")).toBeTruthy();
    expect(screen.getByText("Se connecter")).toBeTruthy();
  });
});

describe("CloudAccountPanel — création de compte puis état connecté", () => {
  it("créer un compte affiche l'état connecté, sans historique local ni cloud", async () => {
    vi.stubEnv("VITE_SUPABASE_URL", "https://example.supabase.co");
    vi.stubEnv("VITE_SUPABASE_ANON_KEY", "test-anon-key");
    const backend = createFakeSupabaseBackend();
    __setSupabaseClientForTests(backend.client);

    render(<CloudAccountPanel storage={DISCONNECTED_STORAGE} isDemo={false} />);

    fireEvent.click(await screen.findByText("Créer un compte")); // bascule le formulaire en mode inscription
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "a@example.com" } });
    fireEvent.change(screen.getByLabelText("Mot de passe"), { target: { value: "password123" } });
    fireEvent.click(screen.getByText("Créer un compte")); // soumet (seul élément restant avec ce texte : le bouton, voir AuthForm)

    expect(await screen.findByText(/Connecté — a@example\.com/)).toBeTruthy();
    // Aucune sortie nulle part : rien à synchroniser, l'état honnête est "synchronisé" (0 sortie).
    await waitFor(() => expect(screen.getByText(/Synchronisé — 0 sortie/)).toBeTruthy());
  });
});

describe("CloudAccountPanel — Phase 11B/11C : réconciliation local/cloud", () => {
  it("détecte des sorties locales pas encore dans le cloud et propose de les synchroniser", async () => {
    vi.stubEnv("VITE_SUPABASE_URL", "https://example.supabase.co");
    vi.stubEnv("VITE_SUPABASE_ANON_KEY", "test-anon-key");
    const backend = createFakeSupabaseBackend();
    __setSupabaseClientForTests(backend.client);
    await backend.signUpAndLogin("a@example.com");

    const root = new MemoryDirectoryHandle();
    await saveActivity(root, makeActivity({ id: "local-1" }), "<gpx/>", "gpx");

    render(<CloudAccountPanel storage={{ status: "connected", rootHandle: root, dirName: "test" }} isDemo={false} />);

    expect(await screen.findByText(/1 sortie pas encore synchronisée/)).toBeTruthy();
    expect(screen.getByText("Synchroniser mes sorties")).toBeTruthy();
  });

  it("propose de télécharger l'historique quand des sorties existent uniquement dans le cloud", async () => {
    vi.stubEnv("VITE_SUPABASE_URL", "https://example.supabase.co");
    vi.stubEnv("VITE_SUPABASE_ANON_KEY", "test-anon-key");
    const backend = createFakeSupabaseBackend();
    __setSupabaseClientForTests(backend.client);
    await backend.signUpAndLogin("phone@example.com");
    await cloudUploadActivity({ activity: makeActivity({ id: "cloud-1" }), originalFileContent: "<gpx/>", sourceFormat: "gpx" });

    render(<CloudAccountPanel storage={DISCONNECTED_STORAGE} isDemo={false} />);

    expect(await screen.findByText(/1 sortie pas encore synchronisée/)).toBeTruthy();
    expect(screen.getByText("Télécharger l'historique")).toBeTruthy();
  });

  it("Synchroniser mes sorties envoie la sortie locale dans le cloud et passe à l'état synchronisé", async () => {
    vi.stubEnv("VITE_SUPABASE_URL", "https://example.supabase.co");
    vi.stubEnv("VITE_SUPABASE_ANON_KEY", "test-anon-key");
    const backend = createFakeSupabaseBackend();
    __setSupabaseClientForTests(backend.client);
    await backend.signUpAndLogin("a@example.com");

    const root = new MemoryDirectoryHandle();
    await saveActivity(root, makeActivity({ id: "local-1" }), "<gpx/>", "gpx");

    render(<CloudAccountPanel storage={{ status: "connected", rootHandle: root, dirName: "test" }} isDemo={false} />);
    fireEvent.click(await screen.findByText("Synchroniser mes sorties"));

    expect(await screen.findByText(/Synchronisé — 1 sortie/)).toBeTruthy();
    await waitFor(() => expect(screen.getByText(/Dernière synchronisation/)).toBeTruthy());
  });
});

describe("CloudAccountPanel — Phase 11C : état honnête", () => {
  it("affiche 'Hors connexion' quand le navigateur est hors ligne, jamais 'Synchronisé'", async () => {
    vi.stubEnv("VITE_SUPABASE_URL", "https://example.supabase.co");
    vi.stubEnv("VITE_SUPABASE_ANON_KEY", "test-anon-key");
    const backend = createFakeSupabaseBackend();
    __setSupabaseClientForTests(backend.client);
    await backend.signUpAndLogin("a@example.com");
    Object.defineProperty(window.navigator, "onLine", { value: false, configurable: true });

    render(<CloudAccountPanel storage={DISCONNECTED_STORAGE} isDemo={false} />);

    expect(await screen.findByText(/Hors connexion/)).toBeTruthy();
    expect(screen.queryByText(/Synchronisé/)).toBeNull();
  });

  it("affiche le nombre d'opérations en file d'attente", async () => {
    vi.stubEnv("VITE_SUPABASE_URL", "https://example.supabase.co");
    vi.stubEnv("VITE_SUPABASE_ANON_KEY", "test-anon-key");
    enqueueUpload({ activityId: "pending-1" });
    const backend = createFakeSupabaseBackend();
    __setSupabaseClientForTests(backend.client);
    await backend.signUpAndLogin("a@example.com");

    render(<CloudAccountPanel storage={DISCONNECTED_STORAGE} isDemo={false} />);

    expect(await screen.findByText(/1 opération en attente/)).toBeTruthy();
  });
});

describe("CloudAccountPanel — Phase 11C : résolution de conflit", () => {
  it("affiche les deux versions et 'Garder cette version' résout le conflit sans écraser silencieusement", async () => {
    vi.stubEnv("VITE_SUPABASE_URL", "https://example.supabase.co");
    vi.stubEnv("VITE_SUPABASE_ANON_KEY", "test-anon-key");
    const backend = createFakeSupabaseBackend();
    __setSupabaseClientForTests(backend.client);
    await backend.signUpAndLogin("a@example.com");

    const root = new MemoryDirectoryHandle();
    await saveActivity(root, makeActivity({ id: "conf-1", distance: 31.2 }), "<gpx/>", "gpx");
    await cloudUploadActivity({ activity: makeActivity({ id: "conf-1", distance: 34.8 }), originalFileContent: "<gpx/>", sourceFormat: "gpx" });

    render(<CloudAccountPanel storage={{ status: "connected", rootHandle: root, dirName: "test" }} isDemo={false} />);

    expect(await screen.findByText(/1 conflit détecté/)).toBeTruthy();
    expect(screen.getByText("31.2 km")).toBeTruthy();
    expect(screen.getByText("34.8 km")).toBeTruthy();

    fireEvent.click(screen.getByText("Garder cette version"));

    await waitFor(() => expect(screen.getByText(/Synchronisé — 1 sortie/)).toBeTruthy());
    expect(screen.queryByText(/conflit détecté/)).toBeNull();
  });

  it("'Plus tard' ne modifie rien : le conflit reste affiché", async () => {
    vi.stubEnv("VITE_SUPABASE_URL", "https://example.supabase.co");
    vi.stubEnv("VITE_SUPABASE_ANON_KEY", "test-anon-key");
    const backend = createFakeSupabaseBackend();
    __setSupabaseClientForTests(backend.client);
    await backend.signUpAndLogin("a@example.com");

    const root = new MemoryDirectoryHandle();
    await saveActivity(root, makeActivity({ id: "conf-1", distance: 31.2 }), "<gpx/>", "gpx");
    await cloudUploadActivity({ activity: makeActivity({ id: "conf-1", distance: 34.8 }), originalFileContent: "<gpx/>", sourceFormat: "gpx" });

    render(<CloudAccountPanel storage={{ status: "connected", rootHandle: root, dirName: "test" }} isDemo={false} />);
    await screen.findByText(/1 conflit détecté/);

    fireEvent.click(screen.getByText("Plus tard"));

    await waitFor(() => expect(screen.getByText(/1 conflit détecté/)).toBeTruthy());
  });
});

import { describe, it, expect, afterEach, vi } from "vitest";
import { render, cleanup, screen } from "@testing-library/react";

import { MemoryDirectoryHandle } from "../lib/storage/testFsHandle.js";
import { saveStravaState, createEmptyStravaState } from "../lib/strava/index.js";
import { DataSourcesView } from "./DataSourcesView.jsx";

afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
});

const DISCONNECTED_STORAGE = { status: "disconnected", rootHandle: null, dirName: null };

function connectedStorage(rootHandle) {
  return { status: "connected", rootHandle, dirName: "mes-sorties" };
}

describe("DataSourcesView — isolation démo", () => {
  it("n'affiche aucune action Strava en mode démo, quel que soit l'état du stockage", () => {
    render(<DataSourcesView storage={connectedStorage(new MemoryDirectoryHandle())} isDemo onBack={() => {}} />);
    expect(screen.getByText(/Indisponible en mode démo/)).toBeTruthy();
    expect(screen.queryByText("Connecter Strava")).toBeNull();
  });
});

describe("DataSourcesView — stockage local non connecté", () => {
  it("demande de connecter d'abord un dossier de stockage avant de proposer Strava", () => {
    render(<DataSourcesView storage={DISCONNECTED_STORAGE} isDemo={false} onBack={() => {}} />);
    expect(screen.getByText(/Connecte d'abord un dossier de stockage local/)).toBeTruthy();
  });
});

describe("DataSourcesView — configuration manquante", () => {
  it("signale une configuration Strava absente (VITE_STRAVA_CLIENT_ID) sans planter", () => {
    vi.stubEnv("VITE_STRAVA_CLIENT_ID", "");
    vi.stubEnv("VITE_STRAVA_REDIRECT_URI", "");
    render(<DataSourcesView storage={connectedStorage(new MemoryDirectoryHandle())} isDemo={false} onBack={() => {}} />);
    expect(screen.getByText(/non configurée/)).toBeTruthy();
  });
});

describe("DataSourcesView — non connecté à Strava", () => {
  it("affiche le bouton Connecter Strava", async () => {
    vi.stubEnv("VITE_STRAVA_CLIENT_ID", "12345");
    vi.stubEnv("VITE_STRAVA_REDIRECT_URI", "http://localhost:5173/");
    render(<DataSourcesView storage={connectedStorage(new MemoryDirectoryHandle())} isDemo={false} onBack={() => {}} />);
    expect(await screen.findByText("Connecter Strava")).toBeTruthy();
    expect(screen.getByText(/Importe automatiquement tes sorties depuis Strava/)).toBeTruthy();
  });
});

describe("DataSourcesView — connecté à Strava", () => {
  it("affiche l'état connecté, le nombre d'activités synchronisées, et les actions Synchroniser/Déconnecter", async () => {
    vi.stubEnv("VITE_STRAVA_CLIENT_ID", "12345");
    vi.stubEnv("VITE_STRAVA_REDIRECT_URI", "http://localhost:5173/");
    const rootHandle = new MemoryDirectoryHandle();
    await saveStravaState(rootHandle, {
      ...createEmptyStravaState(),
      connected: true,
      tokens: { accessToken: "a", refreshToken: "b", expiresAt: Date.now() / 1000 + 3600, scope: "activity:read" },
      athlete: { id: 1, firstname: "Alex", lastname: null },
      connectedAt: new Date().toISOString(),
      lastSyncAt: "2026-06-01T07:00:00.000Z",
      importedStravaIds: ["1", "2", "3"],
      lastSyncSummary: { startedAt: null, finishedAt: null, imported: 3, skippedDuplicates: 0, skippedNonCycling: 0, errors: [] },
    });

    render(<DataSourcesView storage={connectedStorage(rootHandle)} isDemo={false} onBack={() => {}} />);

    expect(await screen.findByText(/Connecté — Alex/)).toBeTruthy();
    expect(screen.getByText(/3 activités synchronisées/)).toBeTruthy();
    expect(screen.getByText("Synchroniser")).toBeTruthy();
    // "Déconnecter" apparaît deux fois : stockage local (StorageSettings) et Strava (StravaConnectionCard).
    expect(screen.getAllByText("Déconnecter")).toHaveLength(2);
  });

  it("affiche les erreurs partielles de la dernière synchro sans exposer de jeton", async () => {
    vi.stubEnv("VITE_STRAVA_CLIENT_ID", "12345");
    vi.stubEnv("VITE_STRAVA_REDIRECT_URI", "http://localhost:5173/");
    const rootHandle = new MemoryDirectoryHandle();
    await saveStravaState(rootHandle, {
      ...createEmptyStravaState(),
      connected: true,
      tokens: { accessToken: "super-secret-token", refreshToken: "b", expiresAt: Date.now() / 1000 + 3600, scope: "activity:read" },
      athlete: { id: 1, firstname: "Alex", lastname: null },
      importedStravaIds: ["1"],
      lastSyncAt: "2026-06-01T07:00:00.000Z",
      lastSyncSummary: { startedAt: null, finishedAt: null, imported: 1, skippedDuplicates: 0, skippedNonCycling: 0, errors: [{ activityId: 42, message: "Activité 42 inaccessible." }] },
    });

    render(<DataSourcesView storage={connectedStorage(rootHandle)} isDemo={false} onBack={() => {}} />);

    expect(await screen.findByText(/Activité 42/)).toBeTruthy();
    expect(document.body.textContent).not.toContain("super-secret-token");
  });
});

describe("DataSourcesView — erreur de callback OAuth", () => {
  it("affiche un message d'erreur explicite (ex. autorisation refusée) sans planter", () => {
    render(
      <DataSourcesView
        storage={connectedStorage(new MemoryDirectoryHandle())}
        isDemo={false}
        onBack={() => {}}
        callbackNotice="Autorisation Strava refusée."
      />
    );
    expect(screen.getByText("Autorisation Strava refusée.")).toBeTruthy();
  });
});

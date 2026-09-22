import { describe, it, expect, afterEach, vi } from "vitest";
import { render, cleanup, screen, waitFor, fireEvent, within } from "@testing-library/react";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { MemoryDirectoryHandle } from "../lib/storage/testFsHandle.js";
import { saveActivity } from "../lib/storage/activityStore.js";
import { createEmptyActivity } from "../lib/types.js";
import { parseFITArrayBuffer } from "../lib/parsers/fitParser.js";
import { computeAnalysis } from "../lib/analysis.js";
import { toActivity } from "../lib/normalize.js";
import { computeCyclistProfile } from "../lib/profile/profile.js";
import { computeProgression } from "../lib/progression/progression.js";
import { matchArchetypes } from "../lib/archetypes/matching.js";
import { HomeView, pickFocusChallenge } from "./HomeView.jsx";
import { stubResizeObserver } from "./testResizeObserverMock.js";

stubResizeObserver();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_PATH = path.join(__dirname, "..", "lib", "parsers", "__fixtures__", "ride-2026-09-20.fit");

function loadFitFixtureArrayBuffer() {
  const buf = fs.readFileSync(FIXTURE_PATH);
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
}

async function loadRealFitActivity() {
  const arrayBuffer = loadFitFixtureArrayBuffer();
  const { name, points, measured } = await parseFITArrayBuffer(arrayBuffer);
  const analysis = computeAnalysis(points, { weight: 75, bikeWeight: 8 });
  const activity = toActivity(analysis, points, { name, sourceType: "fit", originalFilename: "ride.fit", measured });
  return { activity, arrayBuffer };
}

// Points synthétiques produisant à la fois une montée détectable (altitude
// croissante, pente > 2.5 %, gain > 25 m, longueur > 300 m — voir
// analytics/climbs.test.js) ET un effort punch/sprint détectable (puissance
// mesurée, pic net — même motif que progression/challenges.test.js:
// punchyRideSamples), pour obtenir un profil avec plus de dimensions
// exploitables qu'une simple sortie réelle dupliquée.
function richSamples() {
  const points = [];
  let t = 0;
  for (let i = 0; i < 10; i++, t += 10) points.push({ t, lat: i * 0.0005, alt: 100 + i * 3, power: 100 });
  for (let i = 0; i < 9; i++, t += 10) points.push({ t, lat: 0.005 + i * 0.001, alt: 130 + i * 6, power: 320 });
  for (let i = 0; i < 10; i++, t += 10) points.push({ t, lat: 0.015 + i * 0.0005, alt: 184 + i * 1.6, power: 100 });
  return points.map((p) => ({
    timestamp: new Date(p.t * 1000).toISOString(),
    latitude: p.lat,
    longitude: 0,
    altitude: p.alt,
    heartRate: null,
    cadence: null,
    power: p.power,
    temperature: null,
    distanceMeasured: null,
    speedMeasured: null,
  }));
}

function makeActivity(overrides = {}) {
  const a = createEmptyActivity();
  return {
    ...a,
    id: overrides.id || "a1",
    name: overrides.name ?? "Sortie test",
    date: overrides.date ?? "2026-09-20T08:00:00.000Z",
    distance: overrides.distance ?? 45,
    duration: overrides.duration ?? 3 * 3600,
    movingTime: overrides.movingTime ?? 3 * 3600,
    elevationGain: overrides.elevationGain ?? 600,
    elevationLoss: overrides.elevationLoss ?? 580,
    avgSpeed: overrides.avgSpeed ?? 21.6,
    maxSpeed: overrides.maxSpeed ?? 45,
    avgPower: overrides.avgPower ?? null,
    flags: {
      ...a.flags,
      hasGps: true,
      hasElevation: true,
      hasTime: true,
      hasHeartRate: false,
      hasCadence: false,
      hasPower: false,
      powerEstimated: false,
      ...(overrides.flags || {}),
    },
    samples: overrides.samples ?? [],
    gpsTrack: [],
    ...overrides,
  };
}

function richActivity(id, date) {
  return makeActivity({
    id,
    date,
    distance: 45,
    elevationGain: 600,
    movingTime: 3 * 3600,
    duration: 3 * 3600,
    avgPower: 180,
    samples: richSamples(),
    flags: { hasPower: true, powerEstimated: false },
  });
}

async function seed(root, activities) {
  for (const a of activities) {
    await saveActivity(root, a, "<gpx/>", "gpx");
  }
}

function connectedStorage(root) {
  return { status: "connected", rootHandle: root, dirName: "test" };
}

const noop = () => {};
const noopUpload = {
  dragOver: false,
  onDragOver: noop,
  onDragLeave: noop,
  onDrop: noop,
  onBrowseClick: noop,
  error: null,
};

afterEach(cleanup);

describe("pickFocusChallenge — sélection pure, pas une nouvelle métrique", () => {
  it("retourne null sans challenge", () => {
    expect(pickFocusChallenge([])).toBeNull();
    expect(pickFocusChallenge(null)).toBeNull();
  });

  it("choisit le challenge le plus proche d'être atteint (current/target le plus élevé)", () => {
    const challenges = [
      { id: "a", current: 5, target: 100 },
      { id: "b", current: 90, target: 100 },
      { id: "c", current: 30, target: 100 },
    ];
    expect(pickFocusChallenge(challenges).id).toBe("b");
  });

  it("est déterministe : même entrée, même résultat", () => {
    const challenges = [{ id: "a", current: 10, target: 20 }, { id: "b", current: 5, target: 20 }];
    expect(pickFocusChallenge(challenges)).toEqual(pickFocusChallenge(challenges));
  });
});

describe("HomeView — stockage non connecté", () => {
  it("affiche l'écran d'import, jamais une synthèse fabriquée", () => {
    render(
      <HomeView
        storage={{ status: "disconnected", rootHandle: null }}
        onConnect={noop} onReconnect={noop} onNavigate={noop} onOpenActivity={noop} onLoadDemo={noop} upload={noopUpload}
      />
    );
    expect(screen.getByText(/Glissez-déposez votre fichier/)).toBeTruthy();
    expect(screen.queryByText("Bonjour.")).toBeNull();
  });
});

describe("HomeView — chargement", () => {
  it("affiche un état de chargement avant que l'index soit lu, pas l'écran d'import", () => {
    const root = new MemoryDirectoryHandle();
    render(<HomeView storage={connectedStorage(root)} onConnect={noop} onReconnect={noop} onNavigate={noop} onOpenActivity={noop} onLoadDemo={noop} upload={noopUpload} />);
    expect(screen.getByText("Analyse de ton historique…")).toBeTruthy();
    expect(screen.queryByText(/Glissez-déposez votre fichier/)).toBeNull();
  });
});

describe("HomeView — erreur de chargement", () => {
  it("affiche une erreur explicite si la lecture de l'historique échoue", async () => {
    const root = new MemoryDirectoryHandle();
    root.getDirectoryHandle = () => Promise.reject(new Error("panne disque simulée"));
    render(<HomeView storage={connectedStorage(root)} onConnect={noop} onReconnect={noop} onNavigate={noop} onOpenActivity={noop} onLoadDemo={noop} upload={noopUpload} />);
    await waitFor(() => expect(screen.getByText(/panne disque simulée/)).toBeTruthy());
  });

  it("reste utilisable si une activité individuelle ne peut pas être chargée", async () => {
    const root = new MemoryDirectoryHandle();
    await seed(root, [makeActivity({ id: "ok-1", date: "2026-04-05T08:00:00Z" }), makeActivity({ id: "ok-2", date: "2026-05-05T08:00:00Z" })]);
    const activitiesDir = await root.getDirectoryHandle("activities");
    const realGetFileHandle = activitiesDir.getFileHandle.bind(activitiesDir);
    activitiesDir.getFileHandle = async (name, opts) => {
      if (name.includes("ok-1") && name.endsWith(".json")) throw new Error("fichier corrompu simulé");
      return realGetFileHandle(name, opts);
    };

    render(<HomeView storage={connectedStorage(root)} onConnect={noop} onReconnect={noop} onNavigate={noop} onOpenActivity={noop} onLoadDemo={noop} upload={noopUpload} />);
    await waitFor(() => expect(screen.getByText(/n'a pas pu être chargée/)).toBeTruthy());
    expect(screen.getByText("Bonjour.")).toBeTruthy();
  });
});

describe("HomeView — 0 activité", () => {
  it("affiche l'écran d'import (pas de cartes de synthèse sans données)", async () => {
    const root = new MemoryDirectoryHandle();
    render(<HomeView storage={connectedStorage(root)} onConnect={noop} onReconnect={noop} onNavigate={noop} onOpenActivity={noop} onLoadDemo={noop} upload={noopUpload} />);
    await waitFor(() => expect(screen.getByText(/Glissez-déposez votre fichier/)).toBeTruthy());
  });
});

describe("HomeView — cold start (1 vraie sortie, profil insuffisant)", () => {
  it("le focus indique 'Profil en construction', jamais un faux challenge", async () => {
    const root = new MemoryDirectoryHandle();
    const { activity, arrayBuffer } = await loadRealFitActivity();
    await saveActivity(root, activity, arrayBuffer, "fit");

    render(<HomeView storage={connectedStorage(root)} onConnect={noop} onReconnect={noop} onNavigate={noop} onOpenActivity={noop} onLoadDemo={noop} upload={noopUpload} />);
    await waitFor(() => expect(screen.getByText("Bonjour.")).toBeTruthy());

    expect(screen.getByText("Profil en construction")).toBeTruthy();
    expect(screen.getByText(/Continue à enregistrer des sorties/)).toBeTruthy();
  });

  it("les aperçus Alter Ego/Archétype/Profil/Dernière sortie reflètent exactement les moteurs appelés directement", async () => {
    const root = new MemoryDirectoryHandle();
    const { activity, arrayBuffer } = await loadRealFitActivity();
    await saveActivity(root, activity, arrayBuffer, "fit");

    const profile = computeCyclistProfile([activity]);
    const progression = computeProgression([activity], profile);
    const archetypeMatch = matchArchetypes(profile);

    render(<HomeView storage={connectedStorage(root)} onConnect={noop} onReconnect={noop} onNavigate={noop} onOpenActivity={noop} onLoadDemo={noop} upload={noopUpload} />);
    await waitFor(() => expect(screen.getByText("Bonjour.")).toBeTruthy());

    expect(screen.getByText(`Niveau ${progression.level}`)).toBeTruthy();
    expect(screen.getByText(archetypeMatch.combinedLabel)).toBeTruthy();
    expect(screen.getByText(String(profile.dimensions.endurance.value))).toBeTruthy();
    expect(screen.getAllByText("Données insuffisantes").length).toBeGreaterThan(0); // sprint est null sur cette vraie sortie
    expect(screen.getByText(activity.name)).toBeTruthy();
  });
});

describe("HomeView — profil partiel (quelques sorties, dimensions incomplètes)", () => {
  it("le focus propose un challenge actif réel, et les dimensions reflètent le moteur", async () => {
    const root = new MemoryDirectoryHandle();
    const { activity, arrayBuffer } = await loadRealFitActivity();
    const dup1 = { ...activity, id: "dup-1", date: "2026-06-01T08:00:00Z" };
    const dup2 = { ...activity, id: "dup-2", date: "2026-06-08T08:00:00Z" };
    await saveActivity(root, dup1, arrayBuffer, "fit");
    await saveActivity(root, dup2, arrayBuffer, "fit");

    const profile = computeCyclistProfile([dup1, dup2]);
    const progression = computeProgression([dup1, dup2], profile);
    const expectedFocus = pickFocusChallenge(progression.challenges);

    render(<HomeView storage={connectedStorage(root)} onConnect={noop} onReconnect={noop} onNavigate={noop} onOpenActivity={noop} onLoadDemo={noop} upload={noopUpload} />);
    await waitFor(() => expect(screen.getByText("Bonjour.")).toBeTruthy());

    expect(screen.queryByText("Profil en construction")).toBeNull();
    if (expectedFocus) {
      expect(screen.getByText(`${expectedFocus.current} / ${expectedFocus.target} ${expectedFocus.unit}`)).toBeTruthy();
    }
    // Sprint reste insuffisant (pas de puissance mesurée sur ces sorties dupliquées).
    expect(profile.dimensions.sprint.value).toBeNull();
    expect(screen.getAllByText("Données insuffisantes").length).toBeGreaterThan(0);
  });
});

describe("HomeView — profil plus complet (davantage de dimensions exploitables)", () => {
  it("affiche exactement les valeurs (ou l'absence) que produit le moteur pour chaque dimension du bloc Profil", async () => {
    const root = new MemoryDirectoryHandle();
    const activities = Array.from({ length: 6 }, (_, i) => richActivity(`rich-${i}`, `2026-0${(i % 6) + 1}-1${i}T08:00:00Z`));
    await seed(root, activities);

    const profile = computeCyclistProfile(activities);

    render(<HomeView storage={connectedStorage(root)} onConnect={noop} onReconnect={noop} onNavigate={noop} onOpenActivity={noop} onLoadDemo={noop} upload={noopUpload} />);
    await waitFor(() => expect(screen.getByText("Bonjour.")).toBeTruthy());

    for (const dim of ["endurance", "climbing", "punch", "sprint"]) {
      const value = profile.dimensions[dim].value;
      if (value != null) {
        expect(screen.getAllByText(String(value)).length).toBeGreaterThan(0);
      }
    }
  });
});

describe("HomeView — navigation (raccourcis, pas un remplacement de AppNav)", () => {
  const activities = [makeActivity({ id: "a1" })];

  it("ouvre Alter Ego au clic sur son aperçu", async () => {
    const root = new MemoryDirectoryHandle();
    await seed(root, activities);
    const onNavigate = vi.fn();
    render(<HomeView storage={connectedStorage(root)} onConnect={noop} onReconnect={noop} onNavigate={onNavigate} onOpenActivity={noop} onLoadDemo={noop} upload={noopUpload} />);
    await waitFor(() => expect(screen.getByText("Bonjour.")).toBeTruthy());
    fireEvent.click(screen.getByText("Alter Ego").closest(".gpx-home-card"));
    expect(onNavigate).toHaveBeenCalledWith("alterego");
  });

  it("ouvre Archétype au clic sur son aperçu", async () => {
    const root = new MemoryDirectoryHandle();
    await seed(root, activities);
    const onNavigate = vi.fn();
    render(<HomeView storage={connectedStorage(root)} onConnect={noop} onReconnect={noop} onNavigate={onNavigate} onOpenActivity={noop} onLoadDemo={noop} upload={noopUpload} />);
    await waitFor(() => expect(screen.getByText("Bonjour.")).toBeTruthy());
    fireEvent.click(screen.getByText("Ton archétype").closest(".gpx-home-card"));
    expect(onNavigate).toHaveBeenCalledWith("archetype");
  });

  it("ouvre Profil au clic sur 'Voir le profil complet'", async () => {
    const root = new MemoryDirectoryHandle();
    await seed(root, activities);
    const onNavigate = vi.fn();
    render(<HomeView storage={connectedStorage(root)} onConnect={noop} onReconnect={noop} onNavigate={onNavigate} onOpenActivity={noop} onLoadDemo={noop} upload={noopUpload} />);
    await waitFor(() => expect(screen.getByText("Bonjour.")).toBeTruthy());
    fireEvent.click(screen.getByText("Voir le profil complet"));
    expect(onNavigate).toHaveBeenCalledWith("profil");
  });

  it("ouvre l'analyse de la dernière sortie au clic sur 'Voir l'analyse'", async () => {
    const root = new MemoryDirectoryHandle();
    await seed(root, activities);
    const onOpenActivity = vi.fn();
    render(<HomeView storage={connectedStorage(root)} onConnect={noop} onReconnect={noop} onNavigate={noop} onOpenActivity={onOpenActivity} onLoadDemo={noop} upload={noopUpload} />);
    await waitFor(() => expect(screen.getByText("Bonjour.")).toBeTruthy());
    fireEvent.click(screen.getByText("Voir l'analyse"));
    expect(onOpenActivity).toHaveBeenCalledWith("a1");
  });

  it("le lien 'Voir tous mes challenges' du focus mène à Alter Ego, uniquement quand un focus est affiché", async () => {
    const root = new MemoryDirectoryHandle();
    await seed(root, [makeActivity({ id: "a1", date: "2026-06-01T08:00:00Z" }), makeActivity({ id: "a2", date: "2026-06-08T08:00:00Z" })]);
    const onNavigate = vi.fn();
    render(<HomeView storage={connectedStorage(root)} onConnect={noop} onReconnect={noop} onNavigate={onNavigate} onOpenActivity={noop} onLoadDemo={noop} upload={noopUpload} />);
    await waitFor(() => expect(screen.getByText("Bonjour.")).toBeTruthy());
    fireEvent.click(screen.getByText("Voir tous mes challenges"));
    expect(onNavigate).toHaveBeenCalledWith("alterego");
  });
});

describe("HomeView — dernière sortie absente (toutes les activités ont échoué à charger)", () => {
  it("affiche un message honnête plutôt qu'une sortie fabriquée", async () => {
    const root = new MemoryDirectoryHandle();
    await seed(root, [makeActivity({ id: "broken-1" })]);
    // index.json (déjà écrit par seed()) reste lisible : listActivities() réussit.
    // Seule la lecture du détail de "broken-1" échoue, dans le second effet (loadActivityDetail).
    const activitiesDir = await root.getDirectoryHandle("activities");
    const realGetFileHandle = activitiesDir.getFileHandle.bind(activitiesDir);
    activitiesDir.getFileHandle = async (name, opts) => {
      if (name.includes("broken-1") && name.endsWith(".json")) throw new Error("fichier corrompu simulé");
      return realGetFileHandle(name, opts);
    };

    render(<HomeView storage={connectedStorage(root)} onConnect={noop} onReconnect={noop} onNavigate={noop} onOpenActivity={noop} onLoadDemo={noop} upload={noopUpload} />);
    await waitFor(() => expect(screen.getByText("Aucune sortie enregistrée.")).toBeTruthy());
    expect(screen.getByText(/Importe ta première activité pour commencer à construire ton profil/)).toBeTruthy();
  });
});

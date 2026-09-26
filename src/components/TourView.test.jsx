import { describe, it, expect, afterEach, vi } from "vitest";
import { render, cleanup, screen, waitFor, fireEvent, within } from "@testing-library/react";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { MemoryDirectoryHandle } from "../lib/storage/testFsHandle.js";
import { saveActivity } from "../lib/storage/activityStore.js";
import { createEmptyActivity } from "../lib/types.js";
import { parseFITArrayBuffer } from "../lib/parsers/fitParser.js";
import { parseGPXString } from "../lib/parsers/gpxParser.js";
import { computeAnalysis } from "../lib/analysis.js";
import { toActivity } from "../lib/normalize.js";
import { computeCyclistProfile } from "../lib/profile/profile.js";
import { ARCHETYPE_DIMENSIONS } from "../lib/archetypes/archetypes.js";
import { simulateTour, createGenericTour, getStageTypeProfile } from "../lib/simulator/index.js";
import { TourView } from "./TourView.jsx";
import { stubResizeObserver } from "./testResizeObserverMock.js";
import { __setSupabaseClientForTests } from "../lib/cloud/client.js";
import { __resetSyncCoordinatorForTests } from "../lib/storage/activityRepository.js";
import { createFakeSupabaseBackend } from "../lib/cloud/tests/fakeSupabase.js";
import { uploadActivity as cloudUploadActivity } from "../lib/cloud/index.js";

stubResizeObserver();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_PATH = path.join(__dirname, "..", "lib", "parsers", "__fixtures__", "ride-2026-09-20.fit");

const DIMENSION_LABELS = {
  endurance: "Endurance",
  climbing: "Climbing",
  punch: "Punch",
  sprint: "Sprint",
  timeTrial: "Time Trial",
  technical: "Technical",
};

function loadFitFixtureArrayBuffer() {
  const buf = fs.readFileSync(FIXTURE_PATH);
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
}

/** GPX minimal mais réellement parsable (voir ../lib/parsers/gpxParser.js) — sert de second fichier, distinct de la fixture FIT, pour éviter toute collision de hash côté cloud. */
function minimalGpxActivity(id, dateIso) {
  const gpx = `<?xml version="1.0"?><gpx><trk><name>${id}</name><trkseg>
<trkpt lat="45.1000" lon="5.1000"><ele>300</ele><time>${dateIso}</time></trkpt>
<trkpt lat="45.1050" lon="5.1050"><ele>340</ele><time>2026-09-13T08:20:00Z</time></trkpt>
</trkseg></trk></gpx>`;
  const { name, points } = parseGPXString(gpx);
  const analysis = computeAnalysis(points, { weight: 75, bikeWeight: 8 });
  const activity = toActivity(analysis, points, { id, name, sourceType: "gpx", originalFilename: `${id}.gpx`, date: dateIso });
  activity.date = dateIso;
  return { activity, gpxContent: gpx };
}

async function loadRealFitActivity(idOverride, dateOverride) {
  const arrayBuffer = loadFitFixtureArrayBuffer();
  const { name, points, measured } = await parseFITArrayBuffer(arrayBuffer);
  const analysis = computeAnalysis(points, { weight: 75, bikeWeight: 8 });
  const activity = toActivity(analysis, points, { name, sourceType: "fit", originalFilename: "ride.fit", measured });
  if (idOverride) activity.id = idOverride;
  if (dateOverride) activity.date = dateOverride;
  return { activity, arrayBuffer };
}

function makeActivity(overrides = {}) {
  const a = createEmptyActivity();
  return {
    ...a,
    id: overrides.id || "a1",
    name: "Sortie test",
    date: "2026-09-20T08:00:00.000Z",
    distance: 30,
    duration: 5400,
    movingTime: 5000,
    elevationGain: 300,
    elevationLoss: 280,
    avgSpeed: 21.6,
    maxSpeed: 45,
    avgPower: null,
    maxPower: null,
    avgHeartRate: null,
    maxHeartRate: null,
    avgCadence: null,
    maxCadence: null,
    flags: { ...a.flags, hasGps: true, hasHeartRate: false, hasCadence: false, hasPower: false, powerEstimated: false },
    samples: [],
    gpsTrack: [],
    ...overrides,
  };
}

async function seedActivities(root, activities) {
  for (const a of activities) {
    await saveActivity(root, a, "<gpx/>", "gpx");
  }
}

function connectedStorage(root) {
  return { status: "connected", rootHandle: root, dirName: "test" };
}

const noop = () => {};

afterEach(cleanup);

/* ------------------------------------------------------------------ */
/* État initial                                                         */
/* ------------------------------------------------------------------ */

describe("TourView — stockage non connecté", () => {
  it("invite à connecter un dossier, sans jamais appeler le moteur de simulation", () => {
    render(<TourView storage={{ status: "disconnected", rootHandle: null }} onConnect={noop} onReconnect={noop} onViewProfile={noop} onBack={noop} />);
    expect(screen.getByRole("heading", { name: "Tour Simulator", level: 1 })).toBeTruthy();
    expect(screen.getByText(/Connecte un dossier local/)).toBeTruthy();
    expect(screen.queryByText("Commencer")).toBeNull();
  });
});

describe("TourView — 0 activité", () => {
  it("affiche un état vide explicite plutôt qu'un simulateur vide déguisé", async () => {
    const root = new MemoryDirectoryHandle();
    render(<TourView storage={connectedStorage(root)} onConnect={noop} onReconnect={noop} onViewProfile={noop} onBack={noop} />);
    await waitFor(() => expect(screen.getByText(/sera disponible après ta première sortie/)).toBeTruthy());
    expect(screen.queryByText("Commencer")).toBeNull();
  });
});

describe("TourView — profil incomplet (moins de 2 sorties)", () => {
  it("affiche l'état de construction du profil, jamais un 0 pour une dimension inconnue", async () => {
    const root = new MemoryDirectoryHandle();
    await seedActivities(root, [makeActivity({ id: "cold-1" })]);
    const expected = computeCyclistProfile([makeActivity({ id: "cold-1" })]);

    const onViewProfile = vi.fn();
    render(<TourView storage={connectedStorage(root)} onConnect={noop} onReconnect={noop} onViewProfile={onViewProfile} onBack={noop} />);

    await waitFor(() => expect(screen.getByText(/1 sortie analysée/)).toBeTruthy());
    expect(screen.getByText("Construis ton profil de coureur à travers tes sorties.")).toBeTruthy();
    expect(screen.queryByText("0")).toBeNull();
    expect(screen.queryByText("Commencer")).toBeNull();

    for (const dim of ARCHETYPE_DIMENSIONS) {
      if (expected.dimensions[dim].value != null) {
        expect(screen.getAllByText(DIMENSION_LABELS[dim]).length).toBeGreaterThan(0);
      }
    }

    fireEvent.click(screen.getByText("Voir mon profil"));
    expect(onViewProfile).toHaveBeenCalled();
  });
});

/* ------------------------------------------------------------------ */
/* Profil disponible — écran d'accueil du simulateur                   */
/* ------------------------------------------------------------------ */

describe("TourView — profil disponible", () => {
  async function renderAvailable() {
    const root = new MemoryDirectoryHandle();
    const activities = [
      makeActivity({ id: "avail-1", date: "2026-08-01T08:00:00Z" }),
      makeActivity({ id: "avail-2", date: "2026-08-08T08:00:00Z" }),
    ];
    await seedActivities(root, activities);
    const expected = computeCyclistProfile(activities);
    render(<TourView storage={connectedStorage(root)} onConnect={noop} onReconnect={noop} onViewProfile={noop} onBack={noop} />);
    await waitFor(() => expect(screen.getByText(/Basé sur 2 sorties/)).toBeTruthy());
    return { expected };
  }

  it("affiche les valeurs réelles du CyclistProfile, jamais un 0 ni un score inventé pour une dimension absente", async () => {
    const { expected } = await renderAvailable();

    expect(screen.getByText("Ton profil. Un parcours. Une simulation.")).toBeTruthy();

    for (const dim of ARCHETYPE_DIMENSIONS) {
      const label = DIMENSION_LABELS[dim];
      const card = screen.getAllByText(label).map((el) => el.closest(".gpx-profile-card")).find(Boolean);
      expect(card, `carte de dimension "${label}" introuvable`).toBeTruthy();
      const value = expected.dimensions[dim].value;
      if (value == null) {
        expect(within(card).getByText("—")).toBeTruthy();
        expect(within(card).getByText("Données insuffisantes")).toBeTruthy();
        expect(within(card).queryByText("0")).toBeNull();
      } else {
        expect(within(card).getByText(String(value))).toBeTruthy();
      }
    }
  });

  it("affiche le parcours générique avec le bon nombre d'étapes, leur type et leur distance — sans les recopier en dur", async () => {
    await renderAvailable();
    const stages = createGenericTour();

    expect(screen.getByText("Tour découverte")).toBeTruthy();
    expect(screen.getByText(`${stages.length} étapes`)).toBeTruthy();

    const rows = document.querySelectorAll(".gpx-tour-stage-row");
    expect(rows.length).toBe(stages.length);

    // Compare étape par étape, dans l'ordre du parcours (createGenericTour a deux
    // étapes de type "flat" : impossible de vérifier chaque libellé/distance avec
    // getByText seul, il faut les comparer ligne par ligne).
    stages.forEach((stage, i) => {
      const type = getStageTypeProfile(stage.type);
      expect(within(rows[i]).getByText(type.label.toUpperCase())).toBeTruthy();
      expect(within(rows[i]).getByText(`${Math.round(stage.distanceKm)} km`)).toBeTruthy();
    });
  });
});

/* ------------------------------------------------------------------ */
/* Simulation étape par étape                                           */
/* ------------------------------------------------------------------ */

describe("TourView — déroulé de la simulation", () => {
  async function startSimulation() {
    const root = new MemoryDirectoryHandle();
    const activities = [
      makeActivity({ id: "sim-1", date: "2026-08-01T08:00:00Z" }),
      makeActivity({ id: "sim-2", date: "2026-08-08T08:00:00Z" }),
    ];
    await seedActivities(root, activities);
    const profile = computeCyclistProfile(activities);
    render(<TourView storage={connectedStorage(root)} onConnect={noop} onReconnect={noop} onViewProfile={noop} onBack={noop} />);
    await waitFor(() => expect(screen.getByText("Commencer")).toBeTruthy());
    fireEvent.click(screen.getByText("Commencer"));
    return { profile, stages: createGenericTour() };
  }

  it("le bouton Commencer lance la première étape via le moteur 10A (résultat identique à simulateTour, indépendant du seed pour les champs non ajustés)", async () => {
    const { profile, stages } = await startSimulation();
    const reference = simulateTour({ profile, stages, seed: "reference-seed" }).stageResults[0];

    expect(screen.getByText("Étape 1 / 6")).toBeTruthy();
    expect(screen.getByText(getStageTypeProfile(stages[0].type).label.toUpperCase())).toBeTruthy();
    if (reference.affinity != null) {
      expect(screen.getByText(String(reference.affinity))).toBeTruthy();
      expect(screen.getByText(reference.category)).toBeTruthy();
    }
    expect(screen.getByText("Simuler l'étape")).toBeTruthy();
    expect(screen.queryByText("Étape terminée")).toBeNull();
  });

  it("Simuler l'étape révèle un résultat produit par le moteur (performance/fatigue), puis Étape suivante avance la progression", async () => {
    await startSimulation();

    fireEvent.click(screen.getByText("Simuler l'étape"));
    expect(screen.getByText("Étape terminée")).toBeTruthy();
    expect(screen.getByText("Performance simulée")).toBeTruthy();
    expect(screen.getByText("Étape suivante")).toBeTruthy();

    fireEvent.click(screen.getByText("Étape suivante"));
    expect(screen.getByText("Étape 2 / 6")).toBeTruthy();
    expect(screen.getByText("Simuler l'étape")).toBeTruthy();
    expect(screen.queryByText("Étape terminée")).toBeNull();
  });

  it("parcourt les 6 étapes jusqu'à l'écran de fin du Tour, puis Rejouer relance une simulation depuis l'étape 1", async () => {
    await startSimulation();

    for (let i = 0; i < 6; i++) {
      fireEvent.click(screen.getByText("Simuler l'étape"));
      const isLast = i === 5;
      fireEvent.click(screen.getByText(isLast ? "Voir le résumé du Tour" : "Étape suivante"));
    }

    expect(screen.getByText("Tour terminé")).toBeTruthy();
    expect(screen.getByText("6 étapes simulées")).toBeTruthy();
    expect(screen.queryByText(/Tu finis/)).toBeNull();
    expect(screen.queryByText(/classement/i)).toBeNull();

    fireEvent.click(screen.getByText("Rejouer"));
    expect(screen.getByText("Étape 1 / 6")).toBeTruthy();
    expect(screen.getByText("Simuler l'étape")).toBeTruthy();
  });
});

/* ------------------------------------------------------------------ */
/* Navigation                                                           */
/* ------------------------------------------------------------------ */

describe("TourView — navigation", () => {
  it("Retour appelle onBack, Voir les détails appelle onViewProfile", async () => {
    const root = new MemoryDirectoryHandle();
    await seedActivities(root, [
      makeActivity({ id: "nav-1", date: "2026-08-01T08:00:00Z" }),
      makeActivity({ id: "nav-2", date: "2026-08-08T08:00:00Z" }),
    ]);
    const onBack = vi.fn();
    const onViewProfile = vi.fn();
    render(<TourView storage={connectedStorage(root)} onConnect={noop} onReconnect={noop} onViewProfile={onViewProfile} onBack={onBack} />);

    await waitFor(() => expect(screen.getByText("Commencer")).toBeTruthy());
    fireEvent.click(screen.getByText("Voir les détails"));
    expect(onViewProfile).toHaveBeenCalled();

    fireEvent.click(screen.getByText("Retour"));
    expect(onBack).toHaveBeenCalled();
  });
});

/* ------------------------------------------------------------------ */
/* Intégration — profil réel FIT + Tour générique + simulateTour()     */
/* ------------------------------------------------------------------ */

describe("TourView — intégration avec un profil réel (fixture FIT)", () => {
  it("n'affiche que des valeurs réellement calculées par le moteur, sans falsifier le profil réel", async () => {
    const root = new MemoryDirectoryHandle();
    const { activity: a1 } = await loadRealFitActivity("fit-1", "2026-09-13T08:00:00.000Z");
    const { activity: a2, arrayBuffer } = await loadRealFitActivity("fit-2", "2026-09-20T08:00:00.000Z");
    await saveActivity(root, a1, "<gpx/>", "gpx");
    await saveActivity(root, a2, arrayBuffer, "fit");

    const expectedProfile = computeCyclistProfile([a1, a2]);
    const expectedSim = simulateTour({ profile: expectedProfile, stages: createGenericTour(), seed: "integration-seed" });

    render(<TourView storage={connectedStorage(root)} onConnect={noop} onReconnect={noop} onViewProfile={noop} onBack={noop} />);
    await waitFor(() => expect(screen.getByText(/Basé sur 2 sorties/)).toBeTruthy());

    // Aucune valeur impossible n'apparaît pour une dimension quelconque du profil réel.
    for (const dim of ARCHETYPE_DIMENSIONS) {
      const label = DIMENSION_LABELS[dim];
      const card = screen.getAllByText(label).map((el) => el.closest(".gpx-profile-card")).find(Boolean);
      const value = expectedProfile.dimensions[dim].value;
      if (value == null) {
        // Sprint/Technical restent "insuffisant" si c'est réellement le cas pour cette fixture — jamais un score inventé.
        expect(within(card).getByText("Données insuffisantes")).toBeTruthy();
      } else {
        expect(value).toBeGreaterThanOrEqual(0);
        expect(value).toBeLessThanOrEqual(100);
        expect(within(card).getByText(String(value))).toBeTruthy();
      }
    }

    fireEvent.click(screen.getByText("Commencer"));
    const firstResult = expectedSim.stageResults[0];
    if (firstResult.affinity != null) {
      expect(screen.getByText(String(firstResult.affinity))).toBeTruthy();
      expect(screen.getByText(firstResult.category)).toBeTruthy();
    } else {
      expect(screen.getByText("Données insuffisantes")).toBeTruthy();
    }
  });
});

/* ------------------------------------------------------------------ */
/* Structure responsive (le layout lui-même est purement CSS)          */
/* ------------------------------------------------------------------ */

describe("TourView — structure responsive", () => {
  it("les listes/grilles utilisées s'appuient sur les classes responsives existantes (grid/wrap), jamais une largeur fixe", async () => {
    const root = new MemoryDirectoryHandle();
    await seedActivities(root, [
      makeActivity({ id: "resp-1", date: "2026-08-01T08:00:00Z" }),
      makeActivity({ id: "resp-2", date: "2026-08-08T08:00:00Z" }),
    ]);
    render(<TourView storage={connectedStorage(root)} onConnect={noop} onReconnect={noop} onViewProfile={noop} onBack={noop} />);
    await waitFor(() => expect(screen.getByText("Commencer")).toBeTruthy());

    // Réutilise .gpx-profile-grid (auto-fill, déjà responsive ailleurs dans l'app).
    expect(document.querySelector(".gpx-profile-grid")).toBeTruthy();
    // La liste d'étapes est verticale (une colonne), jamais une grille figée en largeur.
    expect(document.querySelector(".gpx-tour-stage-list")).toBeTruthy();

    fireEvent.click(screen.getByText("Commencer"));
    for (let i = 0; i < 6; i++) {
      fireEvent.click(screen.getByText("Simuler l'étape"));
      const isLast = i === 5;
      fireEvent.click(screen.getByText(isLast ? "Voir le résumé du Tour" : "Étape suivante"));
    }
    // Les actions de fin de Tour utilisent une rangée flex qui wrap, jamais un débordement horizontal figé.
    expect(document.querySelector(".gpx-tour-finish-actions")).toBeTruthy();
  });
});

describe("TourView — Phase 11B : profil cloud utilisable (aucun dossier local connecté)", () => {
  afterEach(async () => {
    // Laisse une "tick" à un repository.sync() encore en vol (Phase 11C,
    // déclenché automatiquement au login/mount, voir useActivityRepository.js)
    // pour se terminer contre SON PROPRE backend simulé avant de le neutraliser.
    await new Promise((resolve) => setTimeout(resolve, 0));
    __setSupabaseClientForTests(null);
    __resetSyncCoordinatorForTests();
  });

  it("dépasse le cold start et affiche le Tour à partir de deux sorties disponibles uniquement dans le cloud", async () => {
    const backend = createFakeSupabaseBackend();
    __setSupabaseClientForTests(backend.client);
    await backend.signUpAndLogin("phone@example.com");

    const { activity: a1, arrayBuffer } = await loadRealFitActivity("fit-1", "2026-09-20T08:00:00.000Z");
    const { activity: a2, gpxContent } = minimalGpxActivity("gpx-2", "2026-09-13T08:00:00.000Z");
    await cloudUploadActivity({ activity: a1, originalFileContent: arrayBuffer, sourceFormat: "fit" });
    await cloudUploadActivity({ activity: a2, originalFileContent: gpxContent, sourceFormat: "gpx" });

    render(<TourView storage={{ status: "disconnected", rootHandle: null }} onConnect={noop} onReconnect={noop} onViewProfile={noop} onBack={noop} />);

    await waitFor(() => expect(screen.getByText(/Basé sur 2 sorties/)).toBeTruthy(), { timeout: 3000 });
    expect(screen.getByText("Commencer")).toBeTruthy();
  });
});

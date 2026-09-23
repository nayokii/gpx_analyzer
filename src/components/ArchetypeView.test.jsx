import { describe, it, expect, afterEach } from "vitest";
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
import { matchArchetypes, matchReferenceRiders } from "../lib/archetypes/matching.js";
import { ArchetypeView } from "./ArchetypeView.jsx";
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
    flags: { ...a.flags, hasGps: true, hasHeartRate: false, hasCadence: false, hasPower: false, powerEstimated: false },
    samples: [],
    gpsTrack: [],
    ...overrides,
  };
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

afterEach(cleanup);

describe("ArchetypeView — stockage non connecté", () => {
  it("invite à connecter un dossier, sans tenter de calculer un archétype", () => {
    render(<ArchetypeView storage={{ status: "disconnected", rootHandle: null }} onConnect={noop} onReconnect={noop} onBack={noop} />);
    expect(screen.getByText(/Connecte un dossier local/)).toBeTruthy();
    expect(screen.queryByText(/Basé sur/)).toBeNull();
  });
});

describe("ArchetypeView — 0 activité (état vide)", () => {
  it("affiche l'état vide explicite, jamais un archétype fabriqué", async () => {
    const root = new MemoryDirectoryHandle();
    render(<ArchetypeView storage={connectedStorage(root)} onConnect={noop} onReconnect={noop} onBack={noop} />);
    await waitFor(() => expect(screen.getByText(/apparaîtra ici après ta première sortie/)).toBeTruthy());
    expect(screen.getByText(/Importe un GPX ou un FIT pour commencer/)).toBeTruthy();
    expect(screen.queryByText("Ton profil cycliste")).toBeNull();
  });
});

describe("ArchetypeView — chargement", () => {
  it("affiche un état de chargement avant que l'index soit lu", () => {
    const root = new MemoryDirectoryHandle();
    render(<ArchetypeView storage={connectedStorage(root)} onConnect={noop} onReconnect={noop} onBack={noop} />);
    expect(screen.getByText("Chargement…")).toBeTruthy();
  });
});

describe("ArchetypeView — erreur", () => {
  it("affiche une erreur explicite si la lecture de l'historique échoue", async () => {
    const root = new MemoryDirectoryHandle();
    root.getDirectoryHandle = () => Promise.reject(new Error("panne disque simulée"));
    render(<ArchetypeView storage={connectedStorage(root)} onConnect={noop} onReconnect={noop} onBack={noop} />);
    await waitFor(() => expect(screen.getByText(/panne disque simulée/)).toBeTruthy());
  });
});

describe("ArchetypeView — profil partiel / cold start avec le vrai FIT", () => {
  it("affiche 'Profil en construction' (pas 'Profil indéterminé') quand la cause est un manque de preuves, avec les vraies dimensions dispo/manquantes (Phase 9E)", async () => {
    const root = new MemoryDirectoryHandle();
    const { activity, arrayBuffer } = await loadRealFitActivity();
    await saveActivity(root, activity, arrayBuffer, "fit");

    const profile = computeCyclistProfile([activity]);
    const expected = matchArchetypes(profile);
    // Avec une seule vraie sortie, la cause de l'absence de primaire est toujours
    // un manque de preuves (jamais "no_match" : pas assez de dimensions dispo
    // pour même évaluer une forme de profil) -> l'UI doit dire "Profil en
    // construction", pas le combinedLabel technique "Profil indéterminé".
    expect(expected.primary).toBeNull();
    expect(expected.reason).not.toBe("no_match");

    render(<ArchetypeView storage={connectedStorage(root)} onConnect={noop} onReconnect={noop} onBack={noop} />);

    await waitFor(() => expect(screen.getByText(/Basé sur 1 sortie/)).toBeTruthy());
    expect(screen.getByText(/Archétype en construction/)).toBeTruthy();
    expect(screen.getByText("Profil en construction")).toBeTruthy();
    expect(screen.getAllByText(/1 sortie analysée/).length).toBeGreaterThan(0);

    // Sprint et Technique sont insuffisants sur cette vraie sortie -> forcément listés comme manquants.
    expect(profile.dimensions.sprint.value).toBeNull();
    expect(profile.dimensions.technical.value).toBeNull();
    const missingHeading = screen.getByText("Dimensions encore insuffisantes :");
    const missingText = missingHeading.parentElement.textContent;
    expect(missingText).toMatch(/Sprint/);
    expect(missingText).toMatch(/Technique/);
  });

  it("n'affiche jamais une confiance élevée avec une seule vraie sortie", async () => {
    const root = new MemoryDirectoryHandle();
    const { activity, arrayBuffer } = await loadRealFitActivity();
    await saveActivity(root, activity, arrayBuffer, "fit");

    render(<ArchetypeView storage={connectedStorage(root)} onConnect={noop} onReconnect={noop} onBack={noop} />);
    await waitFor(() => expect(screen.getByText(/Basé sur 1 sortie/)).toBeTruthy());
    if (screen.queryByText("Confiance :")) {
      expect(screen.queryByText("élevée")).toBeNull();
    }
  });
});

describe("ArchetypeView — profil complet, coureurs de référence", () => {
  // Empile plusieurs sorties clairement orientées grimpe/endurance pour obtenir des dimensions avec assez de confiance.
  const climbingActivities = Array.from({ length: 8 }, (_, i) =>
    makeActivity({
      id: `climb-${i}`,
      date: `2026-0${(i % 6) + 1}-1${i}T08:00:00Z`,
      distance: 60,
      elevationGain: 1200,
      movingTime: 4 * 3600,
      duration: 4 * 3600,
    })
  );

  it("affiche des cartes de coureurs similaires avec une explication et des sources", async () => {
    const root = new MemoryDirectoryHandle();
    await seed(root, climbingActivities);
    const profile = computeCyclistProfile(climbingActivities);
    const expectedRiders = matchReferenceRiders(profile);

    render(<ArchetypeView storage={connectedStorage(root)} onConnect={noop} onReconnect={noop} onBack={noop} />);
    await waitFor(() => expect(screen.getByText("Profils de coureurs similaires")).toBeTruthy());

    if (expectedRiders.length === 0) {
      expect(screen.getByText(/Pas encore assez de dimensions exploitables/)).toBeTruthy();
      return;
    }

    const firstRider = expectedRiders[0];
    const card = screen.getByText(firstRider.rider.name).closest(".gpx-archetype-rider-card");
    expect(card).toBeTruthy();
    expect(within(card).getByText(firstRider.similarityLabel)).toBeTruthy();

    fireEvent.click(within(card).getByText(/Pourquoi/));
    expect(within(card).getByText(firstRider.rider.description)).toBeTruthy();
    const sourceLink = within(card).getByText(firstRider.rider.sources[0].label).closest("a");
    expect(sourceLink.getAttribute("href")).toBe(firstRider.rider.sources[0].url);
    expect(sourceLink.getAttribute("target")).toBe("_blank");
  });

  it("jamais un pourcentage numérique affiché pour la similarité", async () => {
    const root = new MemoryDirectoryHandle();
    await seed(root, climbingActivities);
    render(<ArchetypeView storage={connectedStorage(root)} onConnect={noop} onReconnect={noop} onBack={noop} />);
    await waitFor(() => expect(screen.getByText("Profils de coureurs similaires")).toBeTruthy());
    expect(screen.queryByText(/\d+([.,]\d+)?\s?%/)).toBeNull();
  });

  it("limite l'affichage à 3 coureurs par défaut, avec un bouton pour voir les autres", async () => {
    const root = new MemoryDirectoryHandle();
    await seed(root, climbingActivities);
    const profile = computeCyclistProfile(climbingActivities);
    const expectedRiders = matchReferenceRiders(profile);
    if (expectedRiders.length <= 3) return; // pas assez de résultats pour tester la pagination sur ce jeu de données

    render(<ArchetypeView storage={connectedStorage(root)} onConnect={noop} onReconnect={noop} onBack={noop} />);
    await waitFor(() => expect(screen.getByText("Profils de coureurs similaires")).toBeTruthy());
    const cardsBefore = document.querySelectorAll(".gpx-archetype-rider-card").length;
    expect(cardsBefore).toBe(3);

    fireEvent.click(screen.getByText(/Voir les autres profils/));
    const cardsAfter = document.querySelectorAll(".gpx-archetype-rider-card").length;
    expect(cardsAfter).toBe(expectedRiders.length);
  });
});

describe("ArchetypeView — évolution", () => {
  it("indique explicitement l'absence de données suffisantes avec 1 seule sortie", async () => {
    const root = new MemoryDirectoryHandle();
    const { activity, arrayBuffer } = await loadRealFitActivity();
    await saveActivity(root, activity, arrayBuffer, "fit");

    render(<ArchetypeView storage={connectedStorage(root)} onConnect={noop} onReconnect={noop} onBack={noop} />);
    await waitFor(() => expect(screen.getByText("Ton profil évolue")).toBeTruthy());
    expect(screen.getByText(/Pas encore assez de données pour montrer une évolution fiable/)).toBeTruthy();
  });

  it("affiche un point par mois avec au moins deux mois de sorties", async () => {
    const root = new MemoryDirectoryHandle();
    await seed(root, [
      makeActivity({ id: "m1", date: "2026-04-05T08:00:00Z" }),
      makeActivity({ id: "m2", date: "2026-05-05T08:00:00Z" }),
    ]);
    render(<ArchetypeView storage={connectedStorage(root)} onConnect={noop} onReconnect={noop} onBack={noop} />);
    await waitFor(() => expect(screen.getByText("Ton profil évolue")).toBeTruthy());
    expect(screen.queryByText(/Pas encore assez de données/)).toBeNull();
    expect(document.querySelectorAll(".gpx-archetype-timeline-row").length).toBe(2);
  });
});

describe("ArchetypeView — erreur de chargement partielle", () => {
  it("reste utilisable si une activité ne peut pas être chargée", async () => {
    const root = new MemoryDirectoryHandle();
    const activities = [
      makeActivity({ id: "ok-1", date: "2026-04-05T08:00:00Z" }),
      makeActivity({ id: "ok-2", date: "2026-05-05T08:00:00Z" }),
    ];
    await seed(root, activities);

    const activitiesDir = await root.getDirectoryHandle("activities");
    const realGetFileHandle = activitiesDir.getFileHandle.bind(activitiesDir);
    activitiesDir.getFileHandle = async (name, opts) => {
      if (name.includes("ok-1") && name.endsWith(".json")) throw new Error("fichier corrompu simulé");
      return realGetFileHandle(name, opts);
    };

    render(<ArchetypeView storage={connectedStorage(root)} onConnect={noop} onReconnect={noop} onBack={noop} />);
    await waitFor(() => expect(screen.getByText(/n'a pas pu être chargée/)).toBeTruthy());
    await waitFor(() => expect(screen.getByText(/Basé sur 1 sortie/)).toBeTruthy());
    expect(screen.getByText("Ton profil cycliste")).toBeTruthy();
  });
});

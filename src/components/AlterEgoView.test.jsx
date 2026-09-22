import { describe, it, expect, afterEach, vi } from "vitest";
import { render, cleanup, screen, waitFor, within } from "@testing-library/react";
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
import { loadProgressionState } from "../lib/progression/persistence.js";
import { AlterEgoView } from "./AlterEgoView.jsx";
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

describe("AlterEgoView — stockage non connecté", () => {
  it("invite à connecter un dossier, sans tenter de calculer une progression", () => {
    render(<AlterEgoView storage={{ status: "disconnected", rootHandle: null }} onConnect={noop} onReconnect={noop} onBack={noop} />);
    expect(screen.getByText(/Connecte un dossier local/)).toBeTruthy();
    expect(screen.queryByText(/Basé sur/)).toBeNull();
  });
});

describe("AlterEgoView — 0 activité (état vide)", () => {
  it("affiche l'état vide explicite, jamais un niveau fabriqué", async () => {
    const root = new MemoryDirectoryHandle();
    render(<AlterEgoView storage={connectedStorage(root)} onConnect={noop} onReconnect={noop} onBack={noop} />);
    await waitFor(() => expect(screen.getByText(/apparaîtra ici après ta première sortie/)).toBeTruthy());
    expect(screen.getByText(/Importe un GPX ou un FIT pour commencer/)).toBeTruthy();
    expect(screen.queryByText("Niveau")).toBeNull();
  });
});

describe("AlterEgoView — chargement", () => {
  it("affiche un état de chargement avant que l'index soit lu", () => {
    const root = new MemoryDirectoryHandle();
    render(<AlterEgoView storage={connectedStorage(root)} onConnect={noop} onReconnect={noop} onBack={noop} />);
    expect(screen.getByText("Chargement…")).toBeTruthy();
  });
});

describe("AlterEgoView — erreur", () => {
  it("affiche une erreur explicite si la lecture de l'historique échoue", async () => {
    const root = new MemoryDirectoryHandle();
    root.getDirectoryHandle = () => Promise.reject(new Error("panne disque simulée"));
    render(<AlterEgoView storage={connectedStorage(root)} onConnect={noop} onReconnect={noop} onBack={noop} />);
    await waitFor(() => expect(screen.getByText(/panne disque simulée/)).toBeTruthy());
  });
});

describe("AlterEgoView — cold start avec le vrai FIT", () => {
  it("affiche niveau/XP/profil/achievements réellement produits par le moteur, jamais codés en dur", async () => {
    const root = new MemoryDirectoryHandle();
    const { activity, arrayBuffer } = await loadRealFitActivity();
    await saveActivity(root, activity, arrayBuffer, "fit");

    const profile = computeCyclistProfile([activity]);
    const expected = computeProgression([activity], profile);

    render(<AlterEgoView storage={connectedStorage(root)} onConnect={noop} onReconnect={noop} onBack={noop} />);

    await waitFor(() => expect(screen.getByText(/Basé sur 1 sortie/)).toBeTruthy());
    expect(screen.getByText(`Niveau ${expected.level} — ${expected.title}`)).toBeTruthy();
    expect(screen.getByText(/Alter Ego en construction/)).toBeTruthy();

    // Puissance estimée sur cette vraie sortie : jamais FIRST_MEASURED_POWER.
    const measuredPowerAchievement = expected.achievements.find((a) => a.id === "FIRST_MEASURED_POWER");
    expect(measuredPowerAchievement.unlocked).toBe(false);
    const powerBadge = screen.getByText("Puissance mesurée").closest(".gpx-alterego-achievement");
    expect(powerBadge.className).not.toContain("unlocked");

    // FIRST_RIDE doit être débloqué (fait réel : seule sortie).
    const firstRideBadge = screen.getByText("Première sortie").closest(".gpx-alterego-achievement");
    expect(firstRideBadge.className).toContain("unlocked");
  });

  it("affiche les dimensions du profil telles que retournées par computeCyclistProfile, jamais recalculées", async () => {
    const root = new MemoryDirectoryHandle();
    const { activity, arrayBuffer } = await loadRealFitActivity();
    await saveActivity(root, activity, arrayBuffer, "fit");
    const profile = computeCyclistProfile([activity]);

    render(<AlterEgoView storage={connectedStorage(root)} onConnect={noop} onReconnect={noop} onBack={noop} />);
    await waitFor(() => expect(screen.getByText("Profil actuel")).toBeTruthy());

    const enduranceRow = screen.getByText(/Endurance/).closest(".gpx-alterego-profile-row");
    expect(within(enduranceRow).getByText(String(profile.dimensions.endurance.value))).toBeTruthy();

    // Sprint est insuffisant : jamais un score fabriqué, un tiret.
    const sprintRow = screen.getByText(/Sprint/).closest(".gpx-alterego-profile-row");
    expect(profile.dimensions.sprint.value).toBeNull();
    expect(within(sprintRow).getByText("—")).toBeTruthy();
  });

  it("persiste un instantané dans athlete.json après le calcul", async () => {
    const root = new MemoryDirectoryHandle();
    const { activity, arrayBuffer } = await loadRealFitActivity();
    await saveActivity(root, activity, arrayBuffer, "fit");

    render(<AlterEgoView storage={connectedStorage(root)} onConnect={noop} onReconnect={noop} onBack={noop} />);
    await waitFor(() => expect(screen.getByText(/Basé sur 1 sortie/)).toBeTruthy());
    await waitFor(async () => {
      const state = await loadProgressionState(root);
      expect(state).not.toBeNull();
      expect(state.xp).toBeGreaterThan(0);
      expect(state.processedActivityIds).toEqual([activity.id]);
    });
  });
});

describe("AlterEgoView — progression sur plusieurs sorties", () => {
  const activities = [
    makeActivity({ id: "a1", date: "2026-06-01T08:00:00Z", distance: 25 }),
    makeActivity({ id: "a2", date: "2026-06-08T08:00:00Z", distance: 45 }),
    makeActivity({ id: "a3", date: "2026-06-15T08:00:00Z", distance: 30, elevationGain: 600 }),
  ];

  it("affiche un challenge de distance actif avec la progression réelle", async () => {
    const root = new MemoryDirectoryHandle();
    await seed(root, activities);
    render(<AlterEgoView storage={connectedStorage(root)} onConnect={noop} onReconnect={noop} onBack={noop} />);
    await waitFor(() => expect(screen.getByText("Challenges")).toBeTruthy());
    // Meilleure distance = 45 km -> prochain palier non atteint = 50 km (pas 100, déjà au-delà de 40 mais pas de 50).
    expect(screen.getByText(/Faire une sortie de 50 km/)).toBeTruthy();
    expect(screen.getByText("45 / 50 km")).toBeTruthy();
  });

  it("affiche des milestones récemment complétés", async () => {
    const root = new MemoryDirectoryHandle();
    await seed(root, activities);
    render(<AlterEgoView storage={connectedStorage(root)} onConnect={noop} onReconnect={noop} onBack={noop} />);
    await waitFor(() => expect(screen.getByText("Récemment complétés")).toBeTruthy());
    expect(screen.getByText(/✓ 20 km atteints en une sortie/)).toBeTruthy();
  });

  it("affiche des achievements débloqués pour des faits réels", async () => {
    const root = new MemoryDirectoryHandle();
    await seed(root, activities);
    render(<AlterEgoView storage={connectedStorage(root)} onConnect={noop} onReconnect={noop} onBack={noop} />);
    await waitFor(() => expect(screen.getByText("Achievements")).toBeTruthy());
    const km20Badge = screen.getByText("20 km").closest(".gpx-alterego-achievement");
    expect(km20Badge.className).toContain("unlocked");
    const km100Badge = screen.getByText("100 km").closest(".gpx-alterego-achievement");
    expect(km100Badge.className).not.toContain("unlocked");
  });

  it("affiche l'historique XP récent avec la raison de chaque gain", async () => {
    const root = new MemoryDirectoryHandle();
    await seed(root, activities);
    render(<AlterEgoView storage={connectedStorage(root)} onConnect={noop} onReconnect={noop} onBack={noop} />);
    await waitFor(() => expect(screen.getByText("Activité récente")).toBeTruthy());
    expect(screen.getAllByText(/Sortie enregistrée/).length).toBeGreaterThan(0);
  });

  it("ouvre l'activité correspondante au clic sur un événement récent, quand onOpen est fourni", async () => {
    const root = new MemoryDirectoryHandle();
    await seed(root, activities);
    const onOpen = vi.fn();
    render(<AlterEgoView storage={connectedStorage(root)} onConnect={noop} onReconnect={noop} onOpen={onOpen} onBack={noop} />);
    await waitFor(() => expect(screen.getByText("Activité récente")).toBeTruthy());
    const [firstItem] = screen.getAllByRole("listitem");
    firstItem.click();
    expect(onOpen).toHaveBeenCalled();
  });
});

describe("AlterEgoView — idempotence visible (pas d'XP doublée en rechargeant la même vue)", () => {
  it("remonter le même composant sur le même historique donne le même niveau/XP", async () => {
    const root = new MemoryDirectoryHandle();
    const { activity, arrayBuffer } = await loadRealFitActivity();
    await saveActivity(root, activity, arrayBuffer, "fit");

    const { unmount } = render(<AlterEgoView storage={connectedStorage(root)} onConnect={noop} onReconnect={noop} onBack={noop} />);
    await waitFor(() => expect(screen.getByText(/Basé sur 1 sortie/)).toBeTruthy());
    const firstXpText = screen.getByText(/\/ \d+ XP/).textContent;
    unmount();

    render(<AlterEgoView storage={connectedStorage(root)} onConnect={noop} onReconnect={noop} onBack={noop} />);
    await waitFor(() => expect(screen.getByText(/Basé sur 1 sortie/)).toBeTruthy());
    expect(screen.getByText(/\/ \d+ XP/).textContent).toBe(firstXpText);
  });
});

describe("AlterEgoView — erreur de chargement partielle", () => {
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

    render(<AlterEgoView storage={connectedStorage(root)} onConnect={noop} onReconnect={noop} onBack={noop} />);
    await waitFor(() => expect(screen.getByText(/n'a pas pu être chargée/)).toBeTruthy());
    await waitFor(() => expect(screen.getByText(/Basé sur 1 sortie/)).toBeTruthy());
    expect(screen.getByText("Challenges")).toBeTruthy();
  });
});

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
import { buildCoachContext } from "../lib/coach/context.js";
import { analyzeCoachContext } from "../lib/coach/analysis.js";
import { CoachView } from "./CoachView.jsx";
import { stubResizeObserver } from "./testResizeObserverMock.js";
import { __setSupabaseClientForTests } from "../lib/cloud/client.js";
import { __resetSyncCoordinatorForTests } from "../lib/storage/activityRepository.js";
import { createFakeSupabaseBackend } from "../lib/cloud/tests/fakeSupabase.js";
import { uploadActivity as cloudUploadActivity } from "../lib/cloud/index.js";

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
    avgPower: null,
    maxPower: null,
    normalizedPower: null,
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

describe("CoachView — stockage non connecté", () => {
  it("invite à connecter un dossier, sans tenter de construire une analyse", () => {
    render(<CoachView storage={{ status: "disconnected", rootHandle: null }} onConnect={noop} onReconnect={noop} onBack={noop} />);
    expect(screen.getByText(/Connecte un dossier local/)).toBeTruthy();
    expect(screen.queryByText(/sortie.*analysée/)).toBeNull();
  });
});

describe("CoachView — aucune activité", () => {
  it("affiche un état vide explicite, jamais une analyse vide déguisée en résultat", async () => {
    const root = new MemoryDirectoryHandle();
    render(<CoachView storage={connectedStorage(root)} onConnect={noop} onReconnect={noop} onBack={noop} />);
    await waitFor(() => expect(screen.getByText(/apparaîtra ici après ta première sortie/)).toBeTruthy());
    expect(screen.getByText(/Importe un GPX ou un FIT pour commencer/)).toBeTruthy();
    expect(screen.queryByText("Ta dernière sortie")).toBeNull();
  });

  it("ne modifie jamais le stockage (lecture seule stricte)", async () => {
    const root = new MemoryDirectoryHandle();
    render(<CoachView storage={connectedStorage(root)} onConnect={noop} onReconnect={noop} onBack={noop} />);
    await waitFor(() => expect(screen.getByText(/apparaîtra ici/)).toBeTruthy());
    // Aucun FICHIER (aucune donnée) n'a été écrit par le simple fait d'afficher
    // la vue — le dossier "activities" peut être créé vide par listActivities()
    // elle-même (bootstrap déjà existant, commun à toutes les vues), ce n'est
    // pas une écriture de donnée.
    expect(root.files.size).toBe(0);
  });
});

describe("CoachView — rendu avec une vraie analyse (vrai fichier FIT)", () => {
  it("affiche les sections attendues avec les valeurs réellement produites par buildCoachContext/analyzeCoachContext", async () => {
    const root = new MemoryDirectoryHandle();
    const { activity, arrayBuffer } = await loadRealFitActivity();
    await saveActivity(root, activity, arrayBuffer, "fit");

    const expectedContext = buildCoachContext([activity]);
    const expectedAnalysis = analyzeCoachContext(expectedContext);

    render(<CoachView storage={connectedStorage(root)} onConnect={noop} onReconnect={noop} onBack={noop} />);

    await waitFor(() => expect(screen.getByText(/1 sortie analysée/)).toBeTruthy());
    expect(screen.getByText("Ta dernière sortie")).toBeTruthy();
    expect(screen.getByText("Ce qui va dans le bon sens")).toBeTruthy();
    expect(screen.getByText("À surveiller")).toBeTruthy();
    expect(screen.getByText("Ton évolution")).toBeTruthy();
    expect(screen.getByText("Mes recommandations")).toBeTruthy();
    expect(screen.getByText("Limites des données")).toBeTruthy();

    // Le résumé affiché est EXACTEMENT celui produit par analyzeCoachContext (aucun texte recréé dans React).
    expect(screen.getByText(expectedAnalysis.summary)).toBeTruthy();
    // Au moins une limite de données (le module en ajoute toujours une, voir analysis.js).
    for (const limit of expectedAnalysis.dataLimits) {
      expect(screen.getByText(limit.message)).toBeTruthy();
    }
  });

  it("« Copier le journal » place dans le presse-papiers la consigne de coaching et les stats réelles", async () => {
    const root = new MemoryDirectoryHandle();
    const { activity, arrayBuffer } = await loadRealFitActivity();
    await saveActivity(root, activity, arrayBuffer, "fit");
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });

    render(<CoachView storage={connectedStorage(root)} onConnect={noop} onReconnect={noop} onBack={noop} />);
    await waitFor(() => expect(screen.getByText("Me faire coacher par Claude")).toBeTruthy());
    screen.getByRole("button", { name: /Copier le journal/ }).click();

    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
    const text = writeText.mock.calls[0][0];
    expect(text).toContain("Tu es mon coach cycliste");
    expect(text).toContain("## Toutes mes sorties");
    expect(text).toContain("=== Contexte coach");
    await waitFor(() => expect(screen.getByRole("status").textContent).toMatch(/Journal copié/));
  });

  it("1 seule sortie : signale l'analyse en construction (analyse partielle)", async () => {
    const root = new MemoryDirectoryHandle();
    const { activity, arrayBuffer } = await loadRealFitActivity();
    await saveActivity(root, activity, arrayBuffer, "fit");

    render(<CoachView storage={connectedStorage(root)} onConnect={noop} onReconnect={noop} onBack={noop} />);
    await waitFor(() => expect(screen.getByText(/Analyse en construction/)).toBeTruthy());
  });
});

describe("CoachView — puissance mesurée vs estimée", () => {
  it("affiche le badge 'Estimée' pour une puissance non mesurée", async () => {
    const root = new MemoryDirectoryHandle();
    await seed(root, [
      makeActivity({ avgPower: 180, maxPower: 400, normalizedPower: 200, flags: { ...makeActivity().flags, hasPower: true, powerEstimated: true } }),
    ]);
    render(<CoachView storage={connectedStorage(root)} onConnect={noop} onReconnect={noop} onBack={noop} />);
    await waitFor(() => expect(screen.getByText("Estimée")).toBeTruthy());
    expect(screen.queryByText("Mesurée")).toBeNull();
  });

  it("affiche le badge 'Mesurée' pour une puissance issue d'un capteur, jamais confondue avec 'Estimée'", async () => {
    const root = new MemoryDirectoryHandle();
    await seed(root, [
      makeActivity({ avgPower: 180, maxPower: 400, normalizedPower: 200, flags: { ...makeActivity().flags, hasPower: true, powerEstimated: false } }),
    ]);
    render(<CoachView storage={connectedStorage(root)} onConnect={noop} onReconnect={noop} onBack={noop} />);
    await waitFor(() => expect(screen.getByText("Mesurée")).toBeTruthy());
    expect(screen.queryByText("Estimée")).toBeNull();
  });
});

describe("CoachView — absence de données facultatives", () => {
  it("n'affiche ni FC ni cadence ni puissance quand elles sont absentes, sans planter", async () => {
    const root = new MemoryDirectoryHandle();
    await seed(root, [makeActivity()]); // avgHeartRate/avgCadence/avgPower tous null par défaut
    render(<CoachView storage={connectedStorage(root)} onConnect={noop} onReconnect={noop} onBack={noop} />);
    await waitFor(() => expect(screen.getByText("Ta dernière sortie")).toBeTruthy());
    expect(screen.queryByText("FC moyenne")).toBeNull();
    expect(screen.queryByText("Cadence moyenne")).toBeNull();
    expect(screen.getByText("Puissance : non disponible")).toBeTruthy();
  });
});

describe("CoachView — erreur de chargement partielle", () => {
  it("reste utilisable et affiche l'analyse calculée à partir des sorties disponibles", async () => {
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

    render(<CoachView storage={connectedStorage(root)} onConnect={noop} onReconnect={noop} onBack={noop} />);
    await waitFor(() => expect(screen.getByText(/n'a pas pu être chargée/)).toBeTruthy());
    await waitFor(() => expect(screen.getByText(/1 sortie analysée/)).toBeTruthy());
    expect(screen.getByText("Ta dernière sortie")).toBeTruthy();
  });
});

describe("CoachView — Phase Coach V3A : utilise les activités cloud (mode démo jamais impliqué)", () => {
  afterEach(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
    __setSupabaseClientForTests(null);
    __resetSyncCoordinatorForTests();
  });

  it("construit l'analyse à partir d'une sortie disponible uniquement dans le cloud (aucun dossier local connecté)", async () => {
    const backend = createFakeSupabaseBackend();
    __setSupabaseClientForTests(backend.client);
    await backend.signUpAndLogin("phone@example.com");

    const { activity, arrayBuffer } = await loadRealFitActivity();
    await cloudUploadActivity({ activity, originalFileContent: arrayBuffer, sourceFormat: "fit" });

    render(<CoachView storage={{ status: "disconnected", rootHandle: null }} onConnect={noop} onReconnect={noop} onBack={noop} />);

    await waitFor(() => expect(screen.getByText(/1 sortie analysée/)).toBeTruthy(), { timeout: 3000 });
    expect(screen.getByText("Ta dernière sortie")).toBeTruthy();
  });
});

describe("CoachView — structure responsive (classes réutilisées, aucune mise en page ad hoc)", () => {
  it("s'appuie sur les conteneurs/primitives existants (gpx-panel, gpx-stats-grid, gpx-highlight-list), déjà audités pour le mobile", async () => {
    const root = new MemoryDirectoryHandle();
    await seed(root, [makeActivity()]);
    const { container } = render(<CoachView storage={connectedStorage(root)} onConnect={noop} onReconnect={noop} onBack={noop} />);
    await waitFor(() => expect(screen.getByText("Ta dernière sortie")).toBeTruthy());

    expect(container.querySelector(".gpx-dashboard")).toBeTruthy();
    expect(container.querySelectorAll(".gpx-panel").length).toBeGreaterThan(3);
    expect(container.querySelector(".gpx-stats-grid")).toBeTruthy();
    expect(container.querySelectorAll(".gpx-highlight-list, .gpx-empty-note").length).toBeGreaterThan(0);
  });
});

describe("CoachView — bouton Retour", () => {
  it("appelle onBack au clic", async () => {
    const root = new MemoryDirectoryHandle();
    const onBack = vi.fn();
    render(<CoachView storage={connectedStorage(root)} onConnect={noop} onReconnect={noop} onBack={onBack} />);
    await waitFor(() => expect(screen.getByText("Retour")).toBeTruthy());
    screen.getByText("Retour").click();
    expect(onBack).toHaveBeenCalledTimes(1);
  });
});

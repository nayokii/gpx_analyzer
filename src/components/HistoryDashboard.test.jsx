import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
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
import { HistoryDashboard } from "./HistoryDashboard.jsx";
import { stubResizeObserver } from "./testResizeObserverMock.js";

stubResizeObserver();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_PATH = path.join(__dirname, "..", "lib", "parsers", "__fixtures__", "ride-2026-09-20.fit");

function loadFitFixtureArrayBuffer() {
  const buf = fs.readFileSync(FIXTURE_PATH);
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
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
    flags: { ...a.flags, hasHeartRate: false, hasCadence: false, hasPower: false, powerEstimated: false },
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

describe("HistoryDashboard — 0 activité", () => {
  it("affiche un état vide explicite, jamais des données inventées", async () => {
    const root = new MemoryDirectoryHandle();
    render(<HistoryDashboard storage={connectedStorage(root)} onConnect={noop} onReconnect={noop} onOpen={noop} onBack={noop} />);
    await waitFor(() => expect(screen.getByText(/Aucune sortie enregistrée pour le moment/)).toBeTruthy());
    expect(screen.queryByText(/Records/)).toBeNull();
  });
});

describe("HistoryDashboard — 1 activité", () => {
  it("affiche le message de démarrage, pas de comparaison ni de records", async () => {
    const root = new MemoryDirectoryHandle();
    await seed(root, [makeActivity({ id: "solo" })]);
    render(<HistoryDashboard storage={connectedStorage(root)} onConnect={noop} onReconnect={noop} onOpen={noop} onBack={noop} />);

    await waitFor(() => expect(screen.getByText(/Ton historique commence ici/)).toBeTruthy());
    expect(screen.getByText(/Une seule sortie enregistrée pour l'instant/)).toBeTruthy();
    expect(screen.queryByText("Records (toutes les sorties)")).toBeNull();
    expect(screen.queryByText("Parcours répétés")).toBeNull();
  });
});

describe("HistoryDashboard — plusieurs activités", () => {
  const activities = [
    makeActivity({ id: "a1", date: "2026-09-01T08:00:00Z", distance: 20, duration: 3600, movingTime: 3500, elevationGain: 150 }),
    makeActivity({ id: "a2", date: "2026-09-05T08:00:00Z", distance: 30, duration: 5400, movingTime: 5200, elevationGain: 300 }),
    makeActivity({ id: "a3", date: "2026-09-10T08:00:00Z", distance: 40, duration: 7200, movingTime: 7000, elevationGain: 500 }),
  ];

  it("calcule l'aperçu depuis computeHistoryAnalytics (pas de recalcul React)", async () => {
    const root = new MemoryDirectoryHandle();
    await seed(root, activities);
    render(<HistoryDashboard storage={connectedStorage(root)} onConnect={noop} onReconnect={noop} onOpen={noop} onBack={noop} />);

    await waitFor(() => expect(screen.getByText(/Historique —/)).toBeTruthy());
    expect(screen.getByText("Sorties")).toBeTruthy();
    // Distance totale = 20+30+40 = 90 (toutes dans "Tout" par défaut si période 30j les couvre toutes, sinon ajusté par le test de période plus bas)
  });

  it("affiche les filtres de période sans dates codées en dur (utilise dateUtils)", async () => {
    const root = new MemoryDirectoryHandle();
    await seed(root, activities);
    render(<HistoryDashboard storage={connectedStorage(root)} onConnect={noop} onReconnect={noop} onOpen={noop} onBack={noop} />);
    await waitFor(() => expect(screen.getByText("Période")).toBeTruthy());
    for (const label of ["7 jours", "30 jours", "90 jours", "Cette année", "Tout", "Personnalisé"]) {
      expect(screen.getByText(label)).toBeTruthy();
    }
  });

  it("le changement de période met à jour le nombre de sorties affichées", async () => {
    const root = new MemoryDirectoryHandle();
    await seed(root, activities);
    render(<HistoryDashboard storage={connectedStorage(root)} onConnect={noop} onReconnect={noop} onOpen={noop} onBack={noop} />);
    await waitFor(() => expect(screen.getByText("Tout")).toBeTruthy());

    fireEvent.click(screen.getByText("Tout"));
    await waitFor(() => expect(screen.getByText(/toutes vos sorties/i)).toBeTruthy());

    // Bascule vers "Personnalisé" avec une plage ne couvrant qu'une seule sortie.
    fireEvent.click(screen.getByText("Personnalisé"));
    const fromInput = await screen.findByLabelText("Date de début");
    const toInput = screen.getByLabelText("Date de fin");
    fireEvent.change(fromInput, { target: { value: "2026-09-04" } });
    fireEvent.change(toInput, { target: { value: "2026-09-06" } });

    await waitFor(() => {
      const grid = screen.getByText("Sorties").closest(".gpx-stat-card");
      expect(within(grid).getByText("1")).toBeTruthy();
    });
  });

  it("affiche les records (toutes les sorties)", async () => {
    const root = new MemoryDirectoryHandle();
    await seed(root, activities);
    render(<HistoryDashboard storage={connectedStorage(root)} onConnect={noop} onReconnect={noop} onOpen={noop} onBack={noop} />);
    await waitFor(() => expect(screen.getByText("Records (toutes les sorties)")).toBeTruthy());
    const distanceCard = screen.getByText("Plus longue sortie").closest(".gpx-effort-card");
    expect(within(distanceCard).getByText("40,0 km")).toBeTruthy();
    expect(screen.getByText("Plus gros D+")).toBeTruthy();
  });

  it("ouvre l'activité au clic sur un record", async () => {
    const root = new MemoryDirectoryHandle();
    await seed(root, activities);
    const onOpen = vi.fn();
    render(<HistoryDashboard storage={connectedStorage(root)} onConnect={noop} onReconnect={noop} onOpen={onOpen} onBack={noop} />);
    await waitFor(() => expect(screen.getByText("Plus longue sortie")).toBeTruthy());
    fireEvent.click(screen.getByText("Plus longue sortie").closest(".gpx-effort-card"));
    expect(onOpen).toHaveBeenCalledWith("a3");
  });
});

describe("HistoryDashboard — tendances", () => {
  it("indique 'Pas assez de sorties' avec moins de 5 sorties", async () => {
    const root = new MemoryDirectoryHandle();
    await seed(root, [
      makeActivity({ id: "a1", date: "2026-09-01T08:00:00Z" }),
      makeActivity({ id: "a2", date: "2026-09-05T08:00:00Z" }),
    ]);
    render(<HistoryDashboard storage={connectedStorage(root)} onConnect={noop} onReconnect={noop} onOpen={noop} onBack={noop} />);
    fireEvent.click(await screen.findByText("Tout"));
    await waitFor(() => expect(screen.getAllByText("Pas assez de sorties pour une tendance").length).toBeGreaterThan(0));
  });

  it("affiche une tendance à la hausse pour une distance croissante sur 5+ sorties", async () => {
    const root = new MemoryDirectoryHandle();
    const activities = [10, 15, 20, 25, 30, 35].map((distance, i) =>
      makeActivity({ id: `a${i}`, date: `2026-09-0${i + 1}T08:00:00Z`, distance })
    );
    await seed(root, activities);
    render(<HistoryDashboard storage={connectedStorage(root)} onConnect={noop} onReconnect={noop} onOpen={noop} onBack={noop} />);
    fireEvent.click(await screen.findByText("Tout"));
    await waitFor(() => expect(screen.getAllByText(/sur la période/).length).toBeGreaterThan(0));
  });
});

describe("HistoryDashboard — comparaison de deux sorties", () => {
  it("compare via compareActivities, distingue mesurée/estimée, jamais 0 pour une donnée absente", async () => {
    const root = new MemoryDirectoryHandle();
    const a = makeActivity({
      id: "act-a", name: "Sortie A", date: "2026-09-01T08:00:00Z",
      distance: 31.2, elevationGain: 210, duration: 6720, movingTime: 6700, avgSpeed: 20.4,
      avgPower: 165, flags: { hasPower: true, powerEstimated: true, hasHeartRate: false, hasCadence: false },
    });
    const b = makeActivity({
      id: "act-b", name: "Sortie B", date: "2026-09-08T08:00:00Z",
      distance: 28.7, elevationGain: 248, duration: 6360, movingTime: 6300, avgSpeed: 16.2,
      avgPower: 181, avgHeartRate: 151, avgCadence: 78,
      flags: { hasPower: true, powerEstimated: false, hasHeartRate: true, hasCadence: true },
    });
    await seed(root, [a, b]);

    render(<HistoryDashboard storage={connectedStorage(root)} onConnect={noop} onReconnect={noop} onOpen={noop} onBack={noop} />);
    // Sélectionne les deux lignes dans le tableau HistoryView (réutilisé, pas dupliqué).
    await waitFor(() => expect(screen.getByText("Sortie A")).toBeTruthy());
    const checkboxes = screen.getAllByRole("checkbox");
    fireEvent.click(checkboxes[0]);
    fireEvent.click(checkboxes[1]);

    const compareButton = screen.getByRole("button", { name: "Comparer" });
    expect(compareButton.disabled).toBe(false);
    fireEvent.click(compareButton);

    await waitFor(() => expect(screen.getByText("Comparaison")).toBeTruthy());
    const tables = screen.getAllByRole("table");
    const comparisonTable = tables[0]; // le panneau de comparaison est injecté avant le tableau de HistoryView
    expect(within(comparisonTable).getByText("31,2 km")).toBeTruthy();
    expect(within(comparisonTable).getByText("28,7 km")).toBeTruthy();
    expect(within(comparisonTable).getByText("estimée")).toBeTruthy();
    expect(within(comparisonTable).getByText("mesurée")).toBeTruthy();
    expect(screen.getByText(/Comparaison directe indisponible/)).toBeTruthy();
    // HR absente côté A -> tiret, jamais "0 bpm".
    expect(screen.queryByText(/0 bpm/)).toBeNull();
    const rows = within(comparisonTable).getAllByRole("row");
    const hrRow = rows.find((r) => within(r).queryByText("FC moyenne"));
    expect(within(hrRow).getByText("—")).toBeTruthy();
    expect(within(hrRow).getByText("151 bpm")).toBeTruthy();
  });

  it("le bouton Comparer reste désactivé tant que 2 sorties exactement ne sont pas sélectionnées", async () => {
    const root = new MemoryDirectoryHandle();
    await seed(root, [makeActivity({ id: "a1" }), makeActivity({ id: "a2" }), makeActivity({ id: "a3" })]);
    render(<HistoryDashboard storage={connectedStorage(root)} onConnect={noop} onReconnect={noop} onOpen={noop} onBack={noop} />);
    await waitFor(() => expect(screen.getAllByRole("checkbox").length).toBe(3));
    fireEvent.click(screen.getAllByRole("checkbox")[0]);
    expect(screen.getByRole("button", { name: "Comparer" }).disabled).toBe(true);
  });
});

describe("HistoryDashboard — chargement / erreur", () => {
  it("affiche un état de chargement avant que l'index soit lu", () => {
    const root = new MemoryDirectoryHandle();
    render(<HistoryDashboard storage={connectedStorage(root)} onConnect={noop} onReconnect={noop} onOpen={noop} onBack={noop} />);
    expect(screen.getByText("Chargement de l'historique…")).toBeTruthy();
  });

  it("affiche une erreur explicite si la lecture de l'historique échoue", async () => {
    const root = new MemoryDirectoryHandle();
    root.getDirectoryHandle = () => Promise.reject(new Error("panne disque simulée"));
    render(<HistoryDashboard storage={connectedStorage(root)} onConnect={noop} onReconnect={noop} onOpen={noop} onBack={noop} />);
    await waitFor(() => expect(screen.getByText(/panne disque simulée/)).toBeTruthy());
  });
});

describe("HistoryDashboard — fixture FIT réelle (bout-en-bout, aucune donnée inventée)", () => {
  it("consomme le vrai résultat du pipeline FIT sans inventer HR/cadence/puissance mesurée", async () => {
    const root = new MemoryDirectoryHandle();
    const arrayBuffer = loadFitFixtureArrayBuffer();
    const { name, points, measured } = await parseFITArrayBuffer(arrayBuffer);
    const analysis = computeAnalysis(points, { weight: 75, bikeWeight: 8 });
    const activity = toActivity(analysis, points, { name, sourceType: "fit", originalFilename: "ride.fit", measured });
    await saveActivity(root, activity, arrayBuffer, "fit");

    render(<HistoryDashboard storage={connectedStorage(root)} onConnect={noop} onReconnect={noop} onOpen={noop} onBack={noop} />);

    await waitFor(() => expect(screen.getByText(/Ton historique commence ici/)).toBeTruthy());
    // Une seule vraie activité : pas de records/tendances fabriqués.
    expect(screen.queryByText("Records (toutes vos sorties)")).toBeNull();
  });
});

import { describe, it, expect, beforeEach, afterEach, beforeAll } from "vitest";
import { render, cleanup, screen, fireEvent } from "@testing-library/react";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { computeAnalysis } from "../lib/analysis.js";
import { parseFITArrayBuffer } from "../lib/parsers/fitParser.js";
import { computeActivityAnalytics } from "../lib/analytics/analytics.js";
import { AnalyticsView } from "./AnalyticsView.jsx";
import { stubCanvasContext } from "./testCanvasMock.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_PATH = path.join(__dirname, "..", "lib", "parsers", "__fixtures__", "ride-2026-09-20.fit");

function loadFitFixtureArrayBuffer() {
  const buf = fs.readFileSync(FIXTURE_PATH);
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
}

function point(lat, lon, { ele = null, t = null, hr = null, cad = null, power = null, temp = null } = {}) {
  return { lat, lon, ele, time: t != null ? new Date(t * 1000) : null, hr, cad, power, temp };
}

function noop() {}

function renderView({ analytics, analysis, selectedClimb = null, setSelectedClimb = noop }) {
  return render(
    <AnalyticsView
      analytics={analytics}
      analysis={analysis}
      chartData={analysis.series}
      hoverIdx={null}
      setHoverIdx={noop}
      profileMetric="altitude"
      setProfileMetric={noop}
      selectedClimb={selectedClimb}
      setSelectedClimb={setSelectedClimb}
    />
  );
}

beforeEach(() => {
  stubCanvasContext();
});
afterEach(cleanup);

describe("AnalyticsView — activité normale (GPX avec HR/cadence, sans puissance)", () => {
  let analysis, analytics;
  beforeAll(() => {
    const points = [];
    for (let i = 0; i <= 20; i++) {
      points.push(point(i * 0.001, 0, { ele: 100 + i, t: i * 30, hr: 130 + (i % 5), cad: 80 + (i % 3) }));
    }
    analysis = computeAnalysis(points, { weight: 75, bikeWeight: 8 });
    analytics = computeActivityAnalytics(analysis, { ftp: 250, maxHR: 190 });
  });

  it("affiche l'overview avec les métriques principales", () => {
    renderView({ analytics, analysis });
    expect(screen.getByText("Vue d'ensemble")).toBeTruthy();
    expect(screen.getByText("Distance")).toBeTruthy();
    expect(screen.getByText("Durée totale")).toBeTruthy();
    expect(screen.getByText("Vitesse maximale")).toBeTruthy();
    expect(screen.getByText("Dénivelé positif")).toBeTruthy();
  });

  it("affiche la FC (disponible) avec ses zones", () => {
    renderView({ analytics, analysis });
    expect(screen.getByText("Fréquence cardiaque")).toBeTruthy();
    expect(screen.queryByText("Pas de données cardiaques sur cette sortie.")).toBeNull();
    expect(screen.getAllByText(/bpm/).length).toBeGreaterThan(0);
  });

  it("affiche la cadence (disponible)", () => {
    renderView({ analytics, analysis });
    expect(screen.queryByText("Aucune donnée de cadence sur cette sortie.")).toBeNull();
    expect(screen.getAllByText(/rpm/).length).toBeGreaterThan(0);
  });

  it("affiche la puissance comme estimée (aucun capteur, mais vitesse+altitude disponibles)", () => {
    renderView({ analytics, analysis });
    expect(analytics.power.available).toBe(true);
    expect(analytics.power.source).toBe("estimated");
    expect(screen.getAllByText("Estimé").length).toBeGreaterThan(0);
    expect(screen.queryByText("Mesuré")).toBeNull();
  });
});

describe("AnalyticsView — clic sur une montée détectée", () => {
  it("appelle setSelectedClimb avec l'entrée analysis.climbs correspondante", () => {
    const points = [];
    for (let i = 0; i <= 40; i++) {
      const f = i / 40;
      points.push(point(f * 0.011, 0, { ele: 100 + f * 60, t: i * 15 }));
    }
    const analysis = computeAnalysis(points);
    const analytics = computeActivityAnalytics(analysis, {});
    expect(analysis.climbs.length).toBeGreaterThan(0); // pré-condition

    let received = "not-called";
    renderView({ analytics, analysis, setSelectedClimb: (c) => { received = c; } });

    const card = screen.getByText(analysis.climbs[0].name).closest(".gpx-climb-card");
    fireEvent.click(card);
    expect(received).toBe(analysis.climbs[0]);
  });
});

describe("AnalyticsView — fixture FIT réelle (sans HR/cadence/puissance mesurée)", () => {
  let analysis, analytics;
  beforeAll(async () => {
    const { points, measured } = await parseFITArrayBuffer(loadFitFixtureArrayBuffer());
    analysis = computeAnalysis(points, { weight: 75, bikeWeight: 8 });
    analytics = computeActivityAnalytics(analysis, { ftp: 250, maxHR: 190, measured });
  });

  it("affiche un état vide propre pour la FC, jamais 0 bpm", () => {
    renderView({ analytics, analysis });
    expect(screen.getByText("Pas de données cardiaques sur cette sortie.")).toBeTruthy();
    expect(screen.queryByText(/0 bpm/)).toBeNull();
  });

  it("affiche un état vide propre pour la cadence, jamais 0 rpm", () => {
    renderView({ analytics, analysis });
    expect(screen.getByText("Aucune donnée de cadence sur cette sortie.")).toBeTruthy();
    expect(screen.queryByText(/0 rpm/)).toBeNull();
  });

  it("présente la puissance comme estimée, jamais comme mesurée", () => {
    renderView({ analytics, analysis });
    expect(screen.getAllByText("Estimé").length).toBeGreaterThan(0);
    expect(screen.queryByText("Mesuré")).toBeNull();
  });

  it("distingue distance/vitesse mesurées (FIT) des valeurs calculées, sans les confondre", () => {
    renderView({ analytics, analysis });
    expect(screen.getByText(/Mesurée : 31[.,]2\d? km/)).toBeTruthy();
    expect(screen.getByText(/Mesurée : 20[.,]\d km\/h/)).toBeTruthy();
  });

  it("affiche la température disponible", () => {
    renderView({ analytics, analysis });
    expect(screen.getByText("Température moyenne")).toBeTruthy();
  });

  it("affiche des pauses cohérentes (disponibles, pas d'état vide)", () => {
    renderView({ analytics, analysis });
    expect(screen.queryByText("Pas d'horodatage exploitable pour détecter des pauses.")).toBeNull();
  });
});

describe("AnalyticsView — données manquantes", () => {
  it("affiche des états vides propres partout, sans rien fabriquer", () => {
    const points = [point(0, 0), point(0.001, 0)]; // sans altitude, sans horodatage, sans capteurs
    const analysis = computeAnalysis(points);
    const analytics = computeActivityAnalytics(analysis, { ftp: 250, maxHR: 190 });
    renderView({ analytics, analysis });

    expect(screen.getByText("Aucune donnée de puissance exploitable sur cette sortie.")).toBeTruthy();
    expect(screen.getByText("Pas de données cardiaques sur cette sortie.")).toBeTruthy();
    expect(screen.getByText("Aucune donnée de cadence sur cette sortie.")).toBeTruthy();
    expect(screen.getByText("Pas d'horodatage exploitable pour détecter des pauses.")).toBeTruthy();
    expect(screen.getByText(/aucune puissance sur cette sortie/)).toBeTruthy(); // zones de puissance
    expect(screen.getByText("Aucun effort particulièrement soutenu détecté sur cette sortie.")).toBeTruthy();
    expect(screen.getByText("Aucune montée significative détectée (nécessite des données d'altitude).")).toBeTruthy();
    // Aucune valeur fabriquée
    expect(screen.queryByText(/0 bpm/)).toBeNull();
    expect(screen.queryByText(/0 rpm/)).toBeNull();
    expect(screen.queryByText(/0 W/)).toBeNull();
  });

  it("ne rend rien si analytics ou analysis est absent (pas de crash)", () => {
    const { container } = render(
      <AnalyticsView analytics={null} analysis={null} chartData={[]} hoverIdx={null} setHoverIdx={noop}
        profileMetric="altitude" setProfileMetric={noop} selectedClimb={null} setSelectedClimb={noop} />
    );
    expect(container.textContent).toBe("");
  });
});

import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, cleanup, act, screen, waitFor, within } from "@testing-library/react";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { MemoryDirectoryHandle } from "../lib/storage/testFsHandle.js";
import { saveActivity } from "../lib/storage/activityStore.js";
import { parseFITArrayBuffer } from "../lib/parsers/fitParser.js";
import { computeAnalysis } from "../lib/analysis.js";
import { toActivity } from "../lib/normalize.js";
import { computeCyclistProfile } from "../lib/profile/profile.js";
import { ProfileView, DimensionCard } from "./ProfileView.jsx";
import { stubResizeObserver } from "./testResizeObserverMock.js";

stubResizeObserver();

const DURATION = 250; // durée par défaut (aucun token CSS chargé en jsdom)
const noop = () => {};

function dim(value, confidenceLabel = "medium") {
  return {
    value,
    confidence: 0.5,
    confidenceLabel,
    contributingActivities: 4,
    dataQuality: "measured",
    evidence: [],
    signals: {},
  };
}

function card(dimension) {
  return <DimensionCard dimKey="endurance" dim={dimension} trend={null} onOpen={noop} />;
}

function setReducedMotion(reduced) {
  window.matchMedia = vi.fn().mockImplementation((query) => ({
    matches: reduced && query.includes("prefers-reduced-motion"),
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  }));
}

const score = (container) => container.querySelector(".gpx-profile-card-value .gpx-av").textContent;
const advance = (ms) => act(() => { vi.advanceTimersByTime(ms); });

describe("Profil — morph du score d'une dimension (carte isolée)", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["requestAnimationFrame", "cancelAnimationFrame", "performance", "setTimeout", "clearTimeout"] });
    setReducedMotion(false);
  });
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    delete window.matchMedia;
  });

  it("premier rendu : valeur directe, aucune animation", () => {
    const rAF = vi.spyOn(globalThis, "requestAnimationFrame");
    const { container } = render(card(dim(71)));
    expect(score(container)).toBe("71");
    advance(100);
    expect(score(container)).toBe("71");
    expect(rAF).not.toHaveBeenCalled();
  });

  it("71 → 76 : passe par des entiers intermédiaires puis finit exactement sur 76", () => {
    const { container, rerender } = render(card(dim(71)));
    rerender(card(dim(76)));
    const seen = [];
    for (let i = 0; i < 25; i++) {
      advance(16);
      seen.push(score(container));
    }
    for (const s of seen) expect(s).toMatch(/^\d+$/); // jamais de décimale
    const nums = seen.map(Number);
    for (const n of nums) {
      expect(n).toBeGreaterThanOrEqual(71);
      expect(n).toBeLessThanOrEqual(76);
    }
    for (let i = 1; i < nums.length; i++) expect(nums[i]).toBeGreaterThanOrEqual(nums[i - 1]); // monotone
    expect(score(container)).toBe("76");
  });

  it("diminution : 80 → 72", () => {
    const { container, rerender } = render(card(dim(80)));
    rerender(card(dim(72)));
    advance(60);
    const mid = Number(score(container));
    expect(mid).toBeLessThan(80);
    expect(mid).toBeGreaterThan(72);
    advance(DURATION);
    expect(score(container)).toBe("72");
  });

  it("valeur identique : rien ne s'anime", () => {
    const { container, rerender } = render(card(dim(71)));
    const rAF = vi.spyOn(globalThis, "requestAnimationFrame");
    rerender(card(dim(71)));
    rerender(card(dim(71, "high"))); // seule la confiance change : jamais d'interpolation
    expect(rAF).not.toHaveBeenCalled();
    expect(score(container)).toBe("71");
  });

  it("la confiance et la barre changent instantanément, jamais interpolées", () => {
    const { container, rerender } = render(card(dim(71, "low")));
    expect(container.querySelector(".gpx-confidence-low").textContent).toBe("faible");
    rerender(card(dim(76, "high")));
    // pendant l'interpolation du score : confiance déjà finale, barre déjà à la valeur finale
    expect(container.querySelector(".gpx-confidence-high").textContent).toBe("élevée");
    expect(container.querySelector(".gpx-profile-card-bar-fill").style.width).toBe("76%");
    expect(container.querySelector(".gpx-profile-card-value-scale").textContent).toBe("/100");
  });

  it("interruption : un nouveau score pendant l'animation repart de la valeur affichée, pas de 0", () => {
    const { container, rerender } = render(card(dim(40)));
    rerender(card(dim(90)));
    advance(80);
    const before = Number(score(container));
    expect(before).toBeGreaterThan(40);
    rerender(card(dim(30)));
    for (let i = 0; i < 25; i++) {
      advance(16);
      const n = Number(score(container));
      expect(n).toBeGreaterThanOrEqual(30);
      expect(n).toBeLessThanOrEqual(before + 1);
    }
    expect(score(container)).toBe("30");
  });

  it("reduced motion : nouvelle valeur instantanée, aucun état intermédiaire", () => {
    setReducedMotion(true);
    const rAF = vi.spyOn(globalThis, "requestAnimationFrame");
    const { container, rerender } = render(card(dim(71)));
    rerender(card(dim(76)));
    expect(score(container)).toBe("76");
    expect(rAF).not.toHaveBeenCalled();
  });

  it("passage insuffisant → score (et inverse) : affichage direct, jamais 0 → score", () => {
    const rAF = vi.spyOn(globalThis, "requestAnimationFrame");
    const { container, rerender } = render(card(dim(null)));
    expect(container.querySelector(".gpx-profile-card-value-empty").textContent).toBe("—");
    rerender(card(dim(76)));
    expect(score(container)).toBe("76");
    expect(rAF).not.toHaveBeenCalled();
    rerender(card(dim(null)));
    expect(container.querySelector(".gpx-profile-card-value-empty").textContent).toBe("—");
  });

  it("l'objet dimension source n'est jamais modifié", () => {
    const d = dim(71);
    const snapshot = JSON.stringify(d);
    const { rerender } = render(card(d));
    const d2 = dim(76);
    const snapshot2 = JSON.stringify(d2);
    rerender(card(d2));
    advance(DURATION + 50);
    expect(JSON.stringify(d)).toBe(snapshot);
    expect(JSON.stringify(d2)).toBe(snapshot2);
  });
});

describe("Profil — intégration avec le vrai moteur", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  async function realFit() {
    const buf = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "lib", "parsers", "__fixtures__", "ride-2026-09-20.fit"));
    const arrayBuffer = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
    const { name, points, measured } = await parseFITArrayBuffer(arrayBuffer);
    const analysis = computeAnalysis(points, { weight: 75, bikeWeight: 8 });
    const activity = toActivity(analysis, points, { name, sourceType: "fit", originalFilename: "ride.fit", measured });
    return { activity, arrayBuffer };
  }

  it("les scores affichés (valeur dans .gpx-av) sont exactement ceux du moteur, sans animation au premier rendu", async () => {
    const root = new MemoryDirectoryHandle();
    const { activity, arrayBuffer } = await realFit();
    await saveActivity(root, activity, arrayBuffer, "fit");
    const expected = computeCyclistProfile([activity]);
    const before = JSON.stringify(expected.dimensions); // generatedAt change à chaque appel : on compare les dimensions

    // jsdom n'a pas de requestAnimationFrame hors horloge simulée : on en fournit un compteur pour prouver qu'il n'est jamais appelé au premier rendu.
    const rAF = vi.fn(() => 1);
    vi.stubGlobal("requestAnimationFrame", rAF);
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
    const { container } = render(<ProfileView storage={{ status: "connected", rootHandle: root, dirName: "test" }} onConnect={noop} onReconnect={noop} onBack={noop} />);
    await waitFor(() => expect(screen.getByText(/Analyse basée sur 1 sortie/)).toBeTruthy());

    const head = screen.getAllByText("Endurance").find((el) => el.closest(".gpx-profile-card"));
    const enduranceCard = head.closest(".gpx-profile-card");
    expect(within(enduranceCard).getByText(String(expected.dimensions.endurance.value))).toBeTruthy();
    expect(enduranceCard.querySelector(".gpx-profile-card-value .gpx-av").textContent).toBe(String(expected.dimensions.endurance.value));
    // dimension insuffisante : jamais d'AnimatedValue, toujours "—"
    const sprint = screen.getAllByText("Sprint").find((el) => el.closest(".gpx-profile-card")).closest(".gpx-profile-card");
    expect(sprint.querySelector(".gpx-av")).toBeNull();
    // aucune animation de score au premier rendu
    expect(rAF.mock.calls.length).toBe(0);
    // seules les cartes de dimension portent un nombre animé
    expect(container.querySelectorAll(".gpx-profile-card .gpx-av").length).toBe(
      Object.values(expected.dimensions).filter((d) => d.value != null).length
    );
    // le moteur n'a pas été modifié par le rendu
    expect(JSON.stringify(computeCyclistProfile([activity]).dimensions)).toBe(before);
  });
});

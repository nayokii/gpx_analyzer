import { describe, it, expect } from "vitest";
import { computePunch } from "./punch.js";

function effort({ durationSec = 120, avgPowerW = null, avgSpeedKmh = 30, powerSource = "none" } = {}) {
  return { durationSec, avgPowerW, avgSpeedKmh, powerSource };
}

function signal(id, { movingTimeSec = 3600, efforts = [], effortsAnalyzed = true } = {}) {
  return { activityId: id, movingTimeSec, durationSec: movingTimeSec, effortsAnalyzed, efforts };
}

describe("computePunch", () => {
  it("aucune activité analysée pour les efforts : insufficient_data", () => {
    const result = computePunch([signal("a", { effortsAnalyzed: false })]);
    expect(result.value).toBeNull();
  });

  it("activités analysées mais aucun effort punchy détecté : insufficient_data", () => {
    const result = computePunch([signal("a", { efforts: [] }), signal("b", { efforts: [] })]);
    expect(result.value).toBeNull();
  });

  it("liste vide : insufficient_data", () => {
    expect(computePunch([]).value).toBeNull();
  });

  it("un seul effort punchy (cold start) : value définie, confiance faible", () => {
    const result = computePunch([signal("a", { efforts: [effort()] })]);
    expect(result.value).not.toBeNull();
    expect(result.confidence).toBeLessThan(0.35);
  });

  it("exclut les efforts trop longs (> 5 min, relèvent du contre-la-montre, pas du punch)", () => {
    const result = computePunch([signal("a", { efforts: [effort({ durationSec: 600 })] })]);
    expect(result.value).toBeNull(); // aucun effort <= 5 min => aucune preuve
  });

  it("qualité des données : puissance mesurée > estimée > vitesse seule", () => {
    const measured = computePunch([signal("a", { efforts: [effort({ powerSource: "measured", avgPowerW: 300 })] })]);
    const estimated = computePunch([signal("a", { efforts: [effort({ powerSource: "estimated", avgPowerW: 300 })] })]);
    const speedOnly = computePunch([signal("a", { efforts: [effort({ powerSource: "none", avgPowerW: null })] })]);
    expect(measured.dataQuality).toBe("measured");
    expect(estimated.dataQuality).toBe("estimated");
    expect(speedOnly.dataQuality).toBe("speed");
    expect(measured.confidence).toBeGreaterThan(estimated.confidence);
    expect(estimated.confidence).toBeGreaterThan(speedOnly.confidence);
  });

  it("un taux d'efforts par heure plus élevé et répété produit une value plus élevée", () => {
    const rare = computePunch(
      Array.from({ length: 6 }, (_, i) => signal(`a${i}`, { movingTimeSec: 3600, efforts: i === 0 ? [effort()] : [] }))
    );
    const frequent = computePunch(
      Array.from({ length: 6 }, (_, i) => signal(`a${i}`, { movingTimeSec: 3600, efforts: [effort(), effort(), effort()] }))
    );
    expect(frequent.value).toBeGreaterThan(rare.value);
  });

  it("les sorties non analysées n'introduisent pas de faux zéro dans le taux", () => {
    // Une activité sans données temporelles (effortsAnalyzed=false) ne doit pas compter comme "0 effort/heure".
    const withUnanalyzed = computePunch([signal("a", { efforts: [effort()] }), signal("b", { effortsAnalyzed: false })]);
    const withoutUnanalyzed = computePunch([signal("a", { efforts: [effort()] })]);
    expect(withUnanalyzed.signals.analyzedActivities).toBe(1);
    expect(withUnanalyzed.value).toBe(withoutUnanalyzed.value);
  });
});

import { describe, it, expect } from "vitest";
import { computeClimbing } from "./climbing.js";

function signalWithClimbs(id, climbs, extra = {}) {
  return { activityId: id, elevationGainM: extra.elevationGainM ?? null, distanceKm: extra.distanceKm ?? null, climbs };
}

function climb({ gainM = 100, durationSec = 600, avgGrade = 6 } = {}) {
  return { gainM, durationSec, avgGrade, avgPowerW: null };
}

describe("computeClimbing", () => {
  it("aucune montée détectée : insufficient_data", () => {
    const result = computeClimbing([signalWithClimbs("a", [])]);
    expect(result.value).toBeNull();
    expect(result.confidenceLabel).toBe("insufficient_data");
  });

  it("liste vide : insufficient_data", () => {
    expect(computeClimbing([]).value).toBeNull();
  });

  it("une seule montée (cold start) : value définie, confiance faible", () => {
    const result = computeClimbing([signalWithClimbs("a", [climb({ gainM: 80, durationSec: 480 })])]);
    expect(result.value).not.toBeNull();
    expect(result.confidence).toBeLessThan(0.35);
  });

  it("distingue 'beaucoup de D+' de 'bon grimpeur' : le VAM médian ne dépend que du rythme de montée, pas du D+ total cumulé", () => {
    // VAM identique (gain/durée constant) mais D+ total très différent entre deux profils.
    const lowExposure = computeClimbing([
      signalWithClimbs("a", [climb({ gainM: 100, durationSec: 400 })], { elevationGainM: 100 }), // VAM = 900 m/h
    ]);
    const highExposureSameVam = computeClimbing([
      signalWithClimbs("a", [climb({ gainM: 100, durationSec: 400 })], { elevationGainM: 5000 }), // même VAM, D+ total bien plus élevé (une seule montée détectée mais beaucoup de D+ hors montées significatives)
    ]);
    expect(highExposureSameVam.signals.medianVam).toBe(lowExposure.signals.medianVam);
    expect(highExposureSameVam.signals.exposure.totalElevationGainM).toBeGreaterThan(
      lowExposure.signals.exposure.totalElevationGainM
    );
    // Le D+ total, plus élevé, n'entre pas dans le calcul de value (seul le VAM le fait) : value identique.
    expect(highExposureSameVam.value).toBe(lowExposure.value);
  });

  it("un VAM élevé sur une seule montée isolée reste peu fiable (confiance basse) malgré une value haute", () => {
    const result = computeClimbing([signalWithClimbs("a", [climb({ gainM: 300, durationSec: 900 })])]); // VAM = 1200 m/h
    expect(result.confidence).toBeLessThan(0.35);
  });

  it("la médiane amortit un pic de VAM aberrant (artefact GPS)", () => {
    const normal = climb({ gainM: 100, durationSec: 600 }); // VAM 600
    const spike = climb({ gainM: 100, durationSec: 10 }); // VAM 36000, aberrant
    const result = computeClimbing([signalWithClimbs("a", [normal, normal, normal, spike])]);
    expect(result.signals.medianVam).toBeLessThan(1000);
  });

  it("ignore les montées sans durée exploitable", () => {
    const result = computeClimbing([signalWithClimbs("a", [{ gainM: 100, durationSec: null, avgGrade: 5, avgPowerW: null }])]);
    expect(result.value).toBeNull();
  });

  it("la confiance augmente avec le nombre d'activités contributrices", () => {
    const one = computeClimbing([signalWithClimbs("a", [climb()])]);
    const many = computeClimbing(Array.from({ length: 8 }, (_, i) => signalWithClimbs(`a${i}`, [climb()])));
    expect(many.confidence).toBeGreaterThan(one.confidence);
  });
});

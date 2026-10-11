import { describe, it, expect } from "vitest";
import {
  msToKmh, speedFromDistanceTime, sanitizeDeviceAvgKmh, sanitizeDeviceMovingSec,
  resolveAverageSpeed, displayAvgSpeedKmh, MAX_PLAUSIBLE_AVG_KMH,
} from "./speed.js";

describe("unités", () => {
  it("m/s → km/h", () => {
    expect(msToKmh(5.558)).toBeCloseTo(20.0088, 3);
    expect(msToKmh(0)).toBe(0);
  });
  it("valeurs manquantes ou invalides → null", () => {
    for (const v of [null, undefined, NaN, Infinity, "5", {}]) expect(msToKmh(v)).toBeNull();
  });
  it("distance km / durée s → km/h", () => {
    expect(speedFromDistanceTime(31.23099, 5619)).toBeCloseTo(20.009, 2);
    expect(speedFromDistanceTime(36, 3600)).toBe(36);
  });
  it("refuse durée ou distance nulle, négative, absente, non finie", () => {
    for (const [d, t] of [[10, 0], [10, -5], [0, 100], [-1, 100], [null, 100], [10, null], [NaN, 100], [10, Infinity]]) {
      expect(speedFromDistanceTime(d, t)).toBeNull();
    }
  });
});

describe("sanitize", () => {
  it("rejette une vitesse device nulle, négative ou aberrante", () => {
    expect(sanitizeDeviceAvgKmh(20)).toBe(20);
    for (const v of [0, -3, NaN, null, undefined, MAX_PLAUSIBLE_AVG_KMH + 1, 5558]) expect(sanitizeDeviceAvgKmh(v)).toBeNull();
  });
  it("le temps timer ne peut pas dépasser le temps écoulé", () => {
    expect(sanitizeDeviceMovingSec(5619, 6731)).toBe(5619);
    expect(sanitizeDeviceMovingSec(9000, 6731)).toBeNull();
    expect(sanitizeDeviceMovingSec(0, 6731)).toBeNull();
    expect(sanitizeDeviceMovingSec(null, 6731)).toBeNull();
  });
});

describe("resolveAverageSpeed", () => {
  // Valeurs réelles du FIT iGPSPORT : 31,231 km, timer 5619 s, écoulé 6731 s, avg_speed 5,558 m/s.
  const real = { distanceKm: 31.23099, movingTimeSec: 5619, elapsedSec: 6731 };

  it("utilise la vitesse enregistrée par le device quand elle est cohérente", () => {
    const r = resolveAverageSpeed({ ...real, deviceAvgKmh: msToKmh(5.558) });
    expect(r.source).toBe("device");
    expect(r.avgSpeedKmh).toBeCloseTo(20.0088, 3);
  });
  it("sans valeur device : distance / temps en mouvement", () => {
    const r = resolveAverageSpeed(real);
    expect(r.source).toBe("derived");
    expect(r.avgSpeedKmh).toBeCloseTo(20.009, 2);
  });
  it("garde la vitesse sur durée écoulée comme métrique DISTINCTE", () => {
    const r = resolveAverageSpeed({ ...real, deviceAvgKmh: msToKmh(5.558) });
    expect(r.avgSpeedElapsedKmh).toBeCloseTo(16.705, 2);
    expect(r.avgSpeedKmh).not.toBeCloseTo(r.avgSpeedElapsedKmh, 0);
  });
  it("device incohérent avec distance/timer (> 10 %) → ignoré au profit du calcul", () => {
    const r = resolveAverageSpeed({ ...real, deviceAvgKmh: 33 });
    expect(r.source).toBe("derived");
    expect(r.avgSpeedKmh).toBeCloseTo(20.009, 2);
  });
  it("device invalide → calcul ; tout invalide → null", () => {
    expect(resolveAverageSpeed({ ...real, deviceAvgKmh: NaN }).source).toBe("derived");
    expect(resolveAverageSpeed({ ...real, deviceAvgKmh: 0 }).source).toBe("derived");
    const none = resolveAverageSpeed({ distanceKm: null, movingTimeSec: null, deviceAvgKmh: null });
    expect(none).toEqual({ avgSpeedKmh: null, avgSpeedElapsedKmh: null, source: null });
  });
  it("device plausible sans référence de comparaison : accepté tel quel", () => {
    expect(resolveAverageSpeed({ distanceKm: null, movingTimeSec: null, deviceAvgKmh: 22 })).toMatchObject({ avgSpeedKmh: 22, source: "device" });
  });
});

describe("displayAvgSpeedKmh (lecture unique côté UI)", () => {
  it("relit la valeur stockée, jamais une autre durée", () => {
    expect(displayAvgSpeedKmh({ avgSpeed: 20.0, distance: 31.2, duration: 6731, movingTime: 5619 })).toBe(20.0);
  });
  it("valeurs absentes ou invalides → null", () => {
    for (const a of [null, undefined, {}, { avgSpeed: null }, { avgSpeed: 0 }, { avgSpeed: NaN }, { avgSpeed: -2 }, { avgSpeed: 999 }]) {
      expect(displayAvgSpeedKmh(a)).toBeNull();
    }
  });
});

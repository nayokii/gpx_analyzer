import { describe, it, expect } from "vitest";
import { compareLastRideToRecent } from "./comparison.js";

function ride(overrides = {}) {
  return { distanceKm: 30, durationSec: 5400, avgSpeedKmh: 20, elevationGainM: 300, ...overrides };
}

describe("compareLastRideToRecent", () => {
  it("indisponible sans aucune sortie", () => {
    expect(compareLastRideToRecent([])).toEqual({ available: false, reason: "no_last_ride" });
  });

  it("indisponible avec un historique incomplet (seulement la dernière sortie, rien à comparer)", () => {
    expect(compareLastRideToRecent([ride()])).toEqual({ available: false, reason: "insufficient_history", sampleSize: 0 });
  });

  it("compare la dernière sortie à la moyenne des autres, avec un écart en %", () => {
    const last = ride({ distanceKm: 40, durationSec: 6000, avgSpeedKmh: 24, elevationGainM: 400 });
    const others = [ride({ distanceKm: 20 }), ride({ distanceKm: 30 })]; // moyenne = 25
    const result = compareLastRideToRecent([last, ...others]);

    expect(result.available).toBe(true);
    expect(result.sampleSize).toBe(2);
    expect(result.distance.lastValue).toBe(40);
    expect(result.distance.avgOfOthers).toBe(25);
    expect(result.distance.deltaPct).toBeCloseTo(60, 5); // (40-25)/25 * 100
  });

  it("ignore les valeurs null des autres sorties plutôt que de les traiter comme 0", () => {
    const last = ride({ distanceKm: 40 });
    const others = [ride({ distanceKm: null }), ride({ distanceKm: 20 })];
    const result = compareLastRideToRecent([last, ...others]);

    expect(result.distance.sampleSize).toBe(1); // une seule valeur exploitable
    expect(result.distance.avgOfOthers).toBe(20);
  });

  it("renvoie n/d pour une métrique dont la dernière sortie n'a pas de valeur", () => {
    const last = ride({ elevationGainM: null });
    const others = [ride(), ride()];
    const result = compareLastRideToRecent([last, ...others]);

    expect(result.elevationGain.lastValue).toBeNull();
    expect(result.elevationGain.deltaPct).toBeNull();
  });
});

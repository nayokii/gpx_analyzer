import { describe, it, expect } from "vitest";
import { computeEndurance } from "./endurance.js";
import { computePunch } from "./punch.js";
import { computeSprint } from "./sprint.js";
import { computeTimeTrial } from "./timeTrial.js";
import { recentEntries } from "../normalization.js";

// 20 sorties, une par jour ; les 10 plus récentes (i >= 10) prennent la valeur `recent`, les anciennes `old`.
const day = (i) => `2026-03-${String(i + 1).padStart(2, "0")}`;
function rides(make, old, recent) {
  return Array.from({ length: 20 }, (_, i) => make(i, i >= 10 ? recent : old));
}

describe("recentEntries", () => {
  it("renvoie les plus récentes d'abord, et conserve l'ordre sans date", () => {
    expect(recentEntries([{ date: "2026-01-01", v: 1 }, { date: "2026-03-01", v: 3 }, { date: "2026-02-01", v: 2 }], 2).map((e) => e.v)).toEqual([3, 2]);
    expect(recentEntries([{ v: 1 }, { v: 2 }, { v: 3 }], 2).map((e) => e.v)).toEqual([1, 2]);
  });
});

describe("les scores de performance montent quand le niveau récent progresse", () => {
  it("endurance : des sorties plus longues récemment", () => {
    const make = (i, h) => ({ activityId: `a${i}`, date: day(i), movingTimeSec: h * 3600 });
    expect(computeEndurance(rides(make, 2, 4)).value).toBeGreaterThan(computeEndurance(rides(make, 2, 2)).value);
  });

  it("punch : plus d'efforts courts par heure récemment", () => {
    const make = (i, n) => ({
      activityId: `a${i}`, date: day(i), effortsAnalyzed: true, movingTimeSec: 3600,
      efforts: Array.from({ length: n }, () => ({ durationSec: 120, avgPowerW: null, powerSource: "none" })),
    });
    expect(computePunch(rides(make, 1, 4)).value).toBeGreaterThan(computePunch(rides(make, 1, 1)).value);
  });

  it("sprint : un pic de puissance plus élevé récemment", () => {
    const make = (i, w) => ({ activityId: `a${i}`, date: day(i), powerSource: "measured", bestPowerEfforts: { s5: { power: w, duration: 5 } } });
    expect(computeSprint(rides(make, 600, 900)).value).toBeGreaterThan(computeSprint(rides(make, 600, 600)).value);
  });

  it("contre-la-montre : une vitesse soutenue plus élevée récemment", () => {
    const make = (i, v) => ({ activityId: `a${i}`, date: day(i), bestEfforts: { k5: { avgSpeed: v, duration: 600 } } });
    expect(computeTimeTrial(rides(make, 28, 34)).value).toBeGreaterThan(computeTimeTrial(rides(make, 28, 28)).value);
  });
});

describe("progression régulière : le score n'est pas figé au rang du benchmark", () => {
  it("avec 30 sorties de plus en plus longues, le score dépasse le rang constant (~80) qu'on obtenait avant", () => {
    const signals = Array.from({ length: 30 }, (_, i) => ({
      activityId: `a${i}`, date: `2026-03-${String(i + 1).padStart(2, "0")}`, movingTimeSec: (1 + i * 0.1) * 3600,
    }));
    expect(computeEndurance(signals).value).toBeGreaterThan(88);
  });
});

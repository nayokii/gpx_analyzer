import { describe, it, expect } from "vitest";
import { buildClimbGroups, summarizeAttempts, recordsForActivity, compareLatestToBest } from "./climbRegistry.js";

function climb(overrides = {}) {
  return {
    startLat: 45.0, startLon: 6.0, endLat: 45.01, endLon: 6.0,
    distanceM: 1200, gainM: 80, avgGrade: 6.7, durationSec: 480, avgSpeedKmh: 9, avgPowerW: null, avgHeartRateBpm: null,
    ...overrides,
  };
}
const ride = (activityId, date, climbs) => ({ activityId, date, climbs });

describe("buildClimbGroups", () => {
  it("regroupe la même montée parcourue à plusieurs dates, même avec un léger décalage de détection", () => {
    const groups = buildClimbGroups([
      ride("a", "2026-09-01T08:00:00Z", [climb({ durationSec: 500 })]),
      ride("b", "2026-10-01T08:00:00Z", [climb({ startLat: 45.0004, endLat: 45.0102, durationSec: 470 })]),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0].attempts.map((a) => a.activityId)).toEqual(["a", "b"]);
  });

  it("sépare deux montées différentes", () => {
    const groups = buildClimbGroups([
      ride("a", "2026-09-01", [climb(), climb({ startLat: 46, endLat: 46.01 })]),
    ]);
    expect(groups).toHaveLength(2);
  });

  it("ignore les montées sans coordonnées et trie les plus pratiquées d'abord", () => {
    const groups = buildClimbGroups([
      ride("a", "2026-09-01", [climb({ startLat: 46, endLat: 46.01 }), climb({ startLat: null })]),
      ride("b", "2026-09-02", [climb()]),
      ride("c", "2026-09-03", [climb()]),
    ]);
    expect(groups).toHaveLength(2);
    expect(groups[0].attempts).toHaveLength(2);
  });
});

describe("summarizeAttempts", () => {
  const at = (durationSec, date) => ({ durationSec, date, activityId: date });

  it("détecte un record battu au dernier passage", () => {
    const s = summarizeAttempts([at(500, "1"), at(480, "2"), at(450, "3")]);
    expect(s.isLatestBest).toBe(true);
    expect(s.best.durationSec).toBe(450);
    expect(s.deltaVsPreviousBestSec).toBe(-30);
  });

  it("un seul passage : pas de comparaison", () => {
    const s = summarizeAttempts([at(500, "1")]);
    expect(s.isLatestBest).toBe(false);
    expect(s.deltaVsPreviousBestSec).toBeNull();
  });
});

describe("recordsForActivity", () => {
  const groupsFor = (times) => buildClimbGroups(times.map(([id, date, durationSec]) => ride(id, date, [climb({ durationSec })])));

  it("renvoie le record battu lors de la sortie, avec le temps gagné", () => {
    const groups = groupsFor([["a", "2026-09-01", 500], ["b", "2026-09-10", 480], ["c", "2026-10-01", 450]]);
    const records = recordsForActivity(groups, "c");
    expect(records).toHaveLength(1);
    expect(records[0].gainSec).toBe(30);
  });

  it("pas de record : plus lent, premier passage, ou montée absente de la sortie", () => {
    const groups = groupsFor([["a", "2026-09-01", 450], ["b", "2026-10-01", 500]]);
    expect(recordsForActivity(groups, "b")).toEqual([]);
    expect(recordsForActivity(groups, "a")).toEqual([]);
    expect(recordsForActivity(groups, "zzz")).toEqual([]);
  });
});

describe("compareLatestToBest", () => {
  const at = (durationSec, avgPowerW, date) => ({ durationSec, avgPowerW, avgHeartRateBpm: null, date, activityId: date });

  it("plus vite avec plus de puissance : progression", () => {
    expect(compareLatestToBest([at(500, 200, "1"), at(470, 220, "2")]).kind).toBe("progress");
  });
  it("plus vite à puissance égale : conditions", () => {
    expect(compareLatestToBest([at(500, 200, "1"), at(470, 201, "2")]).kind).toBe("conditions");
  });
  it("plus lent malgré plus de puissance : passage difficile", () => {
    expect(compareLatestToBest([at(500, 200, "1"), at(530, 230, "2")]).kind).toBe("harder");
  });
  it("sans puissance : le dit sans conclure ; un seul passage : rien", () => {
    expect(compareLatestToBest([at(500, null, "1"), at(470, null, "2")]).kind).toBe("time-only");
    expect(compareLatestToBest([at(500, 200, "1")])).toBeNull();
  });
});

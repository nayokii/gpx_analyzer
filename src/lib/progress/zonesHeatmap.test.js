import { describe, it, expect } from "vitest";
import { activityZones, zonesForActivities, zoneTotals, zoneSeries, intensityBalance, ZONES } from "./zones.js";
import { collectTracks, decimate, heatmapRange, MAX_POINTS_PER_TRACK } from "./heatmap.js";

const t0 = Date.UTC(2026, 10, 2, 9, 0, 0);
const samples = (n, make) => Array.from({ length: n }, (_, i) => ({ timestamp: new Date(t0 + i * 1000).toISOString(), ...make(i) }));
const act = (date, s, extra = {}) => ({ date: new Date(date).toISOString(), samples: s, ...extra });

describe("zones d'une sortie", () => {
  it("FC : temps par zone selon le % de la FC max", () => {
    const s = samples(101, (i) => ({ heartRate: i < 50 ? 100 : 150 })); // 52 % puis 79 % de 190
    const z = activityZones({ samples: s }, { maxHR: 190 });
    expect(z.mode).toBe("hr");
    expect(Math.abs(z.seconds[0] - 50)).toBeLessThanOrEqual(1); // Z1 (le dt va à l'échantillon d'arrivée : ±1 s)
    expect(Math.abs(z.seconds[2] - 50)).toBeLessThanOrEqual(1); // Z3 (70-80 %)
    expect(z.seconds.reduce((a, b) => a + b, 0)).toBeCloseTo(100, 0);
  });
  it("sans FC : puissance estimée rapportée au FTP, mode « estimated »", () => {
    const z = activityZones({ samples: samples(61, () => ({ power: 200 })) }, { ftp: 250 }); // 0,8 → Z3
    expect(z.mode).toBe("estimated");
    expect(z.seconds[2]).toBeCloseTo(60, 0);
  });
  it("la FC est préférée à la puissance", () => {
    expect(activityZones({ samples: samples(30, () => ({ heartRate: 140, power: 200 })) }, {}).mode).toBe("hr");
  });
  it("une pause (écart > 30 s) n'est pas comptée", () => {
    const s = [{ timestamp: new Date(t0).toISOString(), heartRate: 140 }, { timestamp: new Date(t0 + 1000).toISOString(), heartRate: 140 }, { timestamp: new Date(t0 + 601000).toISOString(), heartRate: 140 }];
    expect(activityZones({ samples: s }, { maxHR: 190 }).seconds.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 0);
  });
  it("sans FC ni puissance ou sans horodatage : null, jamais de zones inventées", () => {
    expect(activityZones({ samples: samples(30, () => ({})) }, {})).toBeNull();
    expect(activityZones({ samples: [{ heartRate: 140 }, { heartRate: 140 }] }, {})).toBeNull();
    expect(activityZones({}, {})).toBeNull();
  });
});

describe("agrégation", () => {
  const entries = zonesForActivities([
    act("2026-11-03T10:00:00", samples(3601, () => ({ heartRate: 120 }))), // 63 % → Z2, 1 h
    act("2026-11-04T10:00:00", samples(3601, () => ({ power: 250 })), {}), // estimé : 1,0 → Z4, 1 h
    act("2026-10-01T10:00:00", samples(3601, () => ({ heartRate: 170 }))), // 89 % → Z4
  ], { maxHR: 190, ftp: 250 });
  it("totaux, pourcentages et part estimée", () => {
    const t = zoneTotals(entries, new Date(2026, 10, 1), new Date(2026, 10, 9));
    expect(t.count).toBe(2);
    expect(t.total).toBeCloseTo(7200, 0);
    expect(t.percent[1]).toBeCloseTo(50, 0);
    expect(t.percent[3]).toBeCloseTo(50, 0);
    expect(t.estimatedShare).toBe(0.5);
  });
  it("sans borne : toutes les sorties", () => expect(zoneTotals(entries).count).toBe(3));
  it("série par période, en minutes par zone", () => {
    const s = zoneSeries(entries, "week", new Date(2026, 10, 2), 3);
    expect(s).toHaveLength(3);
    expect(s[2].z2).toBeCloseTo(60, 0);
    expect(s[2].z4).toBeCloseTo(60, 0);
    expect(s[0].totalMin).toBe(0);
    expect(ZONES.every((z) => typeof s[2][z.key] === "number")).toBe(true);
  });
  it("équilibre d'intensité : rien sans assez de données, phrase sinon", () => {
    expect(intensityBalance(zoneTotals([]))).toBeNull();
    const polar = intensityBalance({ total: 36000, percent: [40, 40, 5, 10, 5] });
    expect(polar.easy).toBe(80);
    expect(polar.text).toMatch(/polarisée/i);
    expect(intensityBalance({ total: 36000, percent: [10, 20, 50, 15, 5] }).text).toMatch(/Tempo/);
  });
});

describe("carte de chaleur", () => {
  const loop = (lat0, n = 1000) => Array.from({ length: n }, (_, i) => ({ lat: lat0 + 0.01 * Math.sin(i / 50), lon: 6 + 0.01 * i / n }));
  const rides = [
    { date: new Date(2026, 10, 3).toISOString(), sportType: "cycling", distance: 40, gpsTrack: loop(45) },
    { date: new Date(2026, 8, 3).toISOString(), sportType: "gravel", distance: 30, gpsTrack: loop(46) },
    { date: new Date(2026, 10, 4).toISOString(), sportType: "cycling", distance: 10, gpsTrack: [] },
  ];
  it("allège chaque tracé en gardant premier et dernier points", () => {
    const pts = loop(45).map((p) => [p.lat, p.lon]);
    const d = decimate(pts);
    expect(d).toHaveLength(MAX_POINTS_PER_TRACK);
    expect(d[0]).toEqual(pts[0]);
    expect(d[d.length - 1]).toEqual(pts[pts.length - 1]);
    expect(decimate([[1, 2], [3, 4]])).toHaveLength(2);
  });
  it("ignore les sorties sans tracé et additionne les distances", () => {
    const r = collectTracks(rides);
    expect(r.count).toBe(2);
    expect(r.distanceKm).toBe(70);
    expect(r.bounds[0][0]).toBeLessThan(r.bounds[1][0]);
  });
  it("filtre par période et par type", () => {
    expect(collectTracks(rides, { from: new Date(2026, 9, 1) }).count).toBe(1);
    expect(collectTracks(rides, { sport: "gravel" }).count).toBe(1);
    expect(collectTracks(rides, { sport: "mtb" })).toMatchObject({ count: 0, bounds: null });
  });
  it("périodes nommées", () => {
    const today = new Date(2026, 10, 15);
    expect(heatmapRange("30d", today).from).toEqual(new Date(2026, 9, 16));
    expect(heatmapRange("all", today)).toEqual({ from: null, to: null });
  });
});

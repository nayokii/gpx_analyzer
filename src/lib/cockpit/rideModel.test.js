import { describe, it, expect } from "vitest";
import { createEmptyActivity } from "../types.js";
import {
  activityToPoints, assessElevation, buildRideModel, buildSummaryRows, buildTelemetryCells,
  cumulativeGain, missingSignals, zoneShares,
} from "./rideModel.js";

/** Trace synthétique d'environ 1,1 km (0,001° de latitude ≈ 111 m), 1 point / 10 s. */
function makeSamples(n, extra = () => ({})) {
  return Array.from({ length: n }, (_, i) => ({
    timestamp: new Date(Date.UTC(2026, 8, 20, 8, 0, i * 10)).toISOString(),
    latitude: 45 + i * 0.001,
    longitude: 5,
    altitude: 100 + i * 2,
    heartRate: null,
    cadence: null,
    power: null,
    temperature: null,
    distanceMeasured: null,
    speedMeasured: null,
    ...extra(i),
  }));
}

function makeActivity(overrides = {}) {
  const base = createEmptyActivity();
  return {
    ...base,
    id: "a1",
    name: "Sortie test",
    distance: 1.1,
    duration: 100,
    movingTime: 95,
    elevationGain: 18,
    avgSpeed: 24.1,
    avgSpeedSource: "derived",
    maxSpeed: 40,
    flags: { ...base.flags, hasGps: true, hasElevation: true, hasTime: true },
    samples: makeSamples(11),
    ...overrides,
  };
}

describe("activityToPoints", () => {
  it("ignore les échantillons sans coordonnées valides, sans jamais les remplacer par 0", () => {
    const samples = makeSamples(4);
    samples[1].latitude = null;
    samples[2].longitude = NaN;
    const pts = activityToPoints({ samples, flags: {} });
    expect(pts).toHaveLength(2);
    expect(pts.every((p) => p.lat !== 0 && p.lon !== 0)).toBe(true);
  });

  it("garde les capteurs absents à null (pas 0)", () => {
    const [p] = activityToPoints({ samples: makeSamples(2), flags: {} });
    expect(p.hr).toBeNull();
    expect(p.cad).toBeNull();
    expect(p.power).toBeNull();
  });

  it("ne réinjecte jamais une puissance estimée comme une mesure", () => {
    const samples = makeSamples(3, () => ({ power: 200 }));
    expect(activityToPoints({ samples, flags: { powerEstimated: true } })[0].power).toBeNull();
    expect(activityToPoints({ samples, flags: { powerEstimated: false } })[0].power).toBe(200);
  });

  it("neutralise un horodatage invalide", () => {
    const samples = makeSamples(2);
    samples[0].timestamp = "pas une date";
    expect(activityToPoints({ samples, flags: {} })[0].time).toBeNull();
  });
});

describe("buildRideModel", () => {
  it("renvoie none sans activité", () => {
    expect(buildRideModel(null).status).toBe("none");
  });

  it("renvoie no-track quand moins de 2 points ont des coordonnées", () => {
    const a = makeActivity({ samples: makeSamples(1) });
    expect(buildRideModel(a).status).toBe("no-track");
    expect(buildRideModel(makeActivity({ samples: [] })).status).toBe("no-track");
  });

  it("produit une analyse prête, des points de graphique et un D+ cumulé cohérent avec l'analyse", () => {
    const model = buildRideModel(makeActivity());
    expect(model.status).toBe("ready");
    expect(model.chartData.length).toBeGreaterThan(1);
    expect(model.cumGain[model.cumGain.length - 1]).toBeCloseTo(model.analysis.elevGain, 6);
    expect(model.analysis.totalDistanceKm).toBeGreaterThan(1);
  });

  it("convertit une exception d'analyse en état error", () => {
    const a = makeActivity();
    Object.defineProperty(a, "samples", { get() { throw new Error("échantillons illisibles"); } });
    const model = buildRideModel(a);
    expect(model.status).toBe("error");
    expect(model.message).toMatch(/illisibles/);
  });
});

describe("assessElevation", () => {
  it("altitude absente", () => {
    expect(assessElevation({ hasEle: false }).reason).toBe("missing");
    expect(assessElevation(null).usable).toBe(false);
  });
  it("altitude constante = inexploitable", () => {
    expect(assessElevation({ hasEle: true, minEle: 120, maxEle: 120.4 })).toEqual({ usable: false, reason: "flat" });
  });
  it("altitude avec relief = exploitable", () => {
    expect(assessElevation({ hasEle: true, minEle: 100, maxEle: 180 })).toEqual({ usable: true, reason: null });
  });
  it("un fichier sans altitude donne un modèle sans profil", () => {
    const a = makeActivity({ samples: makeSamples(11, () => ({ altitude: null })) });
    const model = buildRideModel(a);
    expect(model.status).toBe("ready");
    expect(model.elevation).toEqual({ usable: false, reason: "missing" });
  });
});

describe("cumulativeGain", () => {
  it("n'additionne que les hausses", () => {
    const series = [{ ele: 100 }, { ele: 110 }, { ele: 105 }, { ele: 112 }];
    expect(cumulativeGain(series)).toEqual([0, 10, 10, 17]);
  });
  it("saute les altitudes manquantes", () => {
    expect(cumulativeGain([{ ele: 100 }, { ele: null }, { ele: 120 }])).toEqual([0, 0, 0]);
  });
});

describe("buildTelemetryCells — portée sortie", () => {
  const byKey = (cells) => Object.fromEntries(cells.map((c) => [c.key, c]));

  it("marque indisponibles les capteurs absents, sans afficher 0", () => {
    const a = makeActivity();
    const c = byKey(buildTelemetryCells(a, buildRideModel(a)));
    for (const key of ["hr", "cadence", "power"]) {
      expect(c[key].provenance).toBe("unavailable");
      expect(c[key].value).toBeNull();
      expect(c[key].text).toBe("—");
    }
  });

  it("distingue mesuré / calculé / estimé", () => {
    const a = makeActivity({
      avgHeartRate: 140, avgCadence: 85, avgPower: 200, maxPower: 600,
      flags: { ...makeActivity().flags, hasHeartRate: true, hasCadence: true, hasPower: true, powerEstimated: false },
    });
    const c = byKey(buildTelemetryCells(a, buildRideModel(a)));
    expect(c.hr.provenance).toBe("measured");
    expect(c.cadence.provenance).toBe("measured");
    expect(c.power.provenance).toBe("measured");
    expect(c.distance.provenance).toBe("calculated");
    expect(c.speed.provenance).toBe("calculated");

    const est = makeActivity({ avgPower: 180, flags: { ...makeActivity().flags, hasPower: true, powerEstimated: true } });
    expect(byKey(buildTelemetryCells(est, buildRideModel(est))).power.provenance).toBe("estimated");
  });

  it("la vitesse moyenne issue du device est mesurée", () => {
    const a = makeActivity({ avgSpeedSource: "device" });
    expect(byKey(buildTelemetryCells(a, buildRideModel(a))).speed.provenance).toBe("measured");
  });

  it("n'affiche pas l'altitude quand elle est inexploitable", () => {
    const a = makeActivity({ samples: makeSamples(11, () => ({ altitude: 150 })) });
    const c = byKey(buildTelemetryCells(a, buildRideModel(a)));
    expect(c.altitude.provenance).toBe("unavailable");
  });
});

describe("buildTelemetryCells — portée curseur", () => {
  it("lit les valeurs instantanées du point et le D+ cumulé", () => {
    const a = makeActivity({
      samples: makeSamples(11, (i) => ({ heartRate: 120 + i, cadence: 80, power: null })),
      flags: { ...makeActivity().flags, hasHeartRate: true, hasCadence: true },
    });
    const model = buildRideModel(a);
    const point = model.chartData[5];
    const cells = Object.fromEntries(buildTelemetryCells(a, model, point).map((c) => [c.key, c]));
    expect(cells.hr.value).toBe(point.hr);
    expect(cells.hr.qualifier).toBe("instant.");
    expect(cells.distance.value).toBeCloseTo(point.distance, 6);
    expect(cells.elevGain.value).toBe(model.cumGain[point.idx]);
    expect(cells.power.provenance).toBe("unavailable");
  });

  it("un point sans FC reste indisponible même si la sortie en a ailleurs", () => {
    const a = makeActivity({
      samples: makeSamples(11, (i) => ({ heartRate: i === 5 ? null : 130 })),
      flags: { ...makeActivity().flags, hasHeartRate: true },
    });
    const model = buildRideModel(a);
    const point = model.analysis.series[5];
    expect(Object.fromEntries(buildTelemetryCells(a, model, point).map((c) => [c.key, c])).hr.value).toBeNull();
  });
});

describe("buildSummaryRows", () => {
  const byKey = (rows) => Object.fromEntries(rows.map((r) => [r.key, r]));

  it("distingue temps écoulé et temps en mouvement, vitesse moyenne et maximale", () => {
    const r = byKey(buildSummaryRows(makeActivity()));
    expect(r.elapsed.text).toBe("1:40");
    expect(r.moving.text).toBe("1:35");
    expect(r.avgSpeed.note).toBe("en mouvement");
    expect(r.maxSpeed.value).toBe(40);
    expect(r.avgSpeed.value).toBe(24.1);
  });

  it("n'affiche pas le temps en mouvement quand l'horodatage manque", () => {
    const a = makeActivity({ flags: { ...makeActivity().flags, hasTime: false }, duration: null, movingTime: null });
    const r = byKey(buildSummaryRows(a));
    expect(r.elapsed.provenance).toBe("unavailable");
    expect(r.moving.provenance).toBe("unavailable");
    expect(r.maxSpeed.provenance).toBe("unavailable");
  });

  it("conserve les capteurs absents à null et la puissance estimée marquée estimée", () => {
    const a = makeActivity({ avgPower: 150, maxPower: 420, flags: { ...makeActivity().flags, hasPower: true, powerEstimated: true } });
    const r = byKey(buildSummaryRows(a));
    expect(r.avgHr.value).toBeNull();
    expect(r.avgCad.provenance).toBe("unavailable");
    expect(r.avgPower.provenance).toBe("estimated");
    expect(r.maxPower.provenance).toBe("estimated");
  });
});

describe("missingSignals / zoneShares", () => {
  it("liste les signaux absents", () => {
    expect(missingSignals(makeActivity())).toEqual(["fréquence cardiaque", "cadence", "puissance"]);
    expect(missingSignals(null)).toEqual([]);
  });

  it("zoneShares renvoie null sans temps cumulé et des parts qui somment à 1 sinon", () => {
    expect(zoneShares(null)).toBeNull();
    expect(zoneShares([{ name: "Z1", color: "#000", time: 0 }])).toBeNull();
    const shares = zoneShares([{ name: "Z1", color: "#000", time: 30 }, { name: "Z2", color: "#111", time: 70 }]);
    expect(shares.reduce((s, z) => s + z.share, 0)).toBeCloseTo(1, 10);
    expect(shares[1].share).toBeCloseTo(0.7, 10);
  });
});

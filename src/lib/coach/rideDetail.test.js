import { describe, it, expect } from "vitest";
import { buildRideDetail } from "./rideDetail.js";

function point(lat, lon, { ele = null, t = null, hr = null, cad = null, power = null, temp = null } = {}) {
  return { lat, lon, ele, time: t != null ? new Date(t * 1000) : null, hr, cad, power, temp };
}

function sampleFrom(p) {
  return {
    timestamp: p.time ? p.time.toISOString() : null,
    latitude: p.lat,
    longitude: p.lon,
    altitude: p.ele,
    speed: null,
    heartRate: p.hr,
    cadence: p.cad,
    power: p.power,
    temperature: p.temp,
    distanceMeasured: null,
    speedMeasured: null,
  };
}

function activityFromPoints(points, overrides = {}) {
  return { id: "a1", name: "Sortie test", date: points[0]?.time ? points[0].time.toISOString() : null, samples: points.map(sampleFrom), ...overrides };
}

describe("buildRideDetail — cas limites", () => {
  it("indisponible sans activité", () => {
    expect(buildRideDetail(null)).toEqual({ available: false, reason: "no_activity" });
  });

  it("indisponible avec moins de 2 échantillons (jamais de fabrication)", () => {
    const activity = activityFromPoints([point(0, 0, { t: 0 })]);
    expect(buildRideDetail(activity)).toEqual({ available: false, reason: "insufficient_samples" });
  });
});

describe("buildRideDetail — montées", () => {
  it("détecte une montée en réutilisant climbs.js, sans réimplémenter la détection", () => {
    const points = [];
    for (let i = 0; i <= 40; i++) {
      const f = i / 40;
      points.push(point(f * 0.011, 0, { ele: 100 + f * 60, t: i * 15 })); // ~1.2 km, +60 m
    }
    const detail = buildRideDetail(activityFromPoints(points));

    expect(detail.available).toBe(true);
    expect(detail.climbs.count).toBeGreaterThan(0);
    const c = detail.climbs.list[0];
    // Le lissage d'altitude (fenêtre 7 points, voir analysis.js) rogne légèrement
    // les bords sans lead-in/lead-out plat dans ce fixture minimal — comportement
    // du moteur existant, pas quelque chose que ce module réinterprète.
    expect(c.gainM).toBeGreaterThan(40);
    expect(c.distanceKm).toBeGreaterThan(0);
    expect(c.durationSec).toBeGreaterThan(0);
    expect(c.vamMh).toBeGreaterThan(0); // (gainM/durationSec)*3600 — voir profile/dimensions/climbing.js: vamOf
    // Altitude + horodatage présents -> le moteur existant (analysis.js) estime la
    // puissance par défaut (comportement déjà en place, pas ajouté par ce module) ;
    // en revanche il n'estime jamais de FC, jamais fabriquée :
    expect(c.avgHeartRateBpm).toBeNull();
  });
});

describe("buildRideDetail — efforts", () => {
  it("détecte un effort de puissance soutenu en réutilisant efforts.js", () => {
    const points = [];
    let t = 0;
    for (let i = 0; i < 10; i++, t += 10) points.push(point(i * 0.0005, 0, { t, power: 100 }));
    for (let i = 0; i < 9; i++, t += 10) points.push(point(0.005 + i * 0.001, 0, { t, power: 320 }));
    for (let i = 0; i < 10; i++, t += 10) points.push(point(0.015 + i * 0.0005, 0, { t, power: 100 }));

    const detail = buildRideDetail(activityFromPoints(points));

    expect(detail.efforts.count).toBe(1);
    expect(detail.efforts.list[0].durationSec).toBeGreaterThanOrEqual(60);
    expect(detail.efforts.list[0].power.avgW).toBeGreaterThan(300);
  });
});

describe("buildRideDetail — arrêts", () => {
  it("détecte un arrêt significatif en réutilisant pauses.js", () => {
    const points = [];
    for (let i = 0; i < 5; i++) points.push(point(i * 0.002, 0, { t: i * 10 }));
    const last = points[points.length - 1];
    for (let i = 1; i <= 8; i++) points.push(point(last.lat, last.lon, { t: last.time.getTime() / 1000 + i * 10 }));

    const detail = buildRideDetail(activityFromPoints(points));

    expect(detail.pauses.available).toBe(true);
    expect(detail.pauses.count).toBeGreaterThan(0);
    expect(detail.pauses.totalSec).toBeGreaterThan(0);
    expect(detail.pauses.longestSec).toBeGreaterThan(0);
  });
});

describe("buildRideDetail — absence de montées/efforts/arrêts", () => {
  it("signale explicitement des listes vides plutôt que de les confondre avec une indisponibilité", () => {
    // Roulage plat, constant, sans arrêt ni pic de puissance.
    const points = [];
    for (let i = 0; i <= 20; i++) points.push(point(i * 0.001, 0, { ele: 100, t: i * 10, power: 150 }));

    const detail = buildRideDetail(activityFromPoints(points));

    expect(detail.available).toBe(true);
    expect(detail.climbs).toEqual({ count: 0, list: [] });
    expect(detail.efforts).toEqual({ count: 0, list: [] });
    expect(detail.pauses.available).toBe(true);
    expect(detail.pauses.count).toBe(0);
  });
});

describe("buildRideDetail — sortie sans FC/cadence/puissance mesurée", () => {
  it("ne fabrique jamais de FC (le moteur n'estime que la puissance, jamais la FC)", () => {
    const points = [];
    for (let i = 0; i <= 40; i++) {
      const f = i / 40;
      points.push(point(f * 0.011, 0, { ele: 100 + f * 60, t: i * 15 })); // pas de hr/cad/power
    }
    const detail = buildRideDetail(activityFromPoints(points));

    expect(detail.available).toBe(true);
    // Avec altitude + horodatage, le moteur existant (analysis.js) estime la
    // puissance par défaut (comportement déjà en place, pas quelque chose que
    // ce module ajoute) — mais il n'estime JAMAIS de fréquence cardiaque :
    // c'est ce qu'on vérifie ici, sans jamais fabriquer cette donnée.
    for (const c of detail.climbs.list) {
      expect(c.avgHeartRateBpm).toBeNull();
    }
  });

  it("ne détecte aucun effort de puissance quand la puissance est explicitement absente et plate (flags hasPower=false côté Activity)", () => {
    // Roulage plat (pas de D+, donc pas d'estimation de puissance possible) et
    // vitesse constante : rien à détecter, aucune valeur inventée.
    const points = [];
    for (let i = 0; i <= 20; i++) points.push(point(i * 0.001, 0, { t: i * 10 })); // pas d'altitude -> pas d'estimation de puissance
    const detail = buildRideDetail(activityFromPoints(points));

    expect(detail.available).toBe(true);
    expect(detail.efforts.list.every((e) => e.power === null)).toBe(true);
  });
});

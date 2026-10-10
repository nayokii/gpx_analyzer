import { describe, it, expect } from "vitest";
import {
  extractRoute, isValidCoord, trimRouteEnds, simplifyRoute, projectRoute, shareRoute, routeLengthMeters,
  filterAndSortActivities, availableTypes, displayName, buildStats, elevationProfile, activityTypeLabel,
} from "./feedModel.js";
import { loopRoute } from "./testRoutes.js";

const act = (o = {}) => ({ id: "a", name: "Sortie", date: "2026-09-20T08:00:00Z", sportType: "cycling", distance: 40, ...o });

describe("extractRoute — GPS complet / absent / invalide", () => {
  it("retourne les coordonnées d'un gpsTrack complet", () => {
    const route = extractRoute({ gpsTrack: loopRoute(50) });
    expect(route).toHaveLength(50);
  });
  it("retombe sur les samples si gpsTrack est vide", () => {
    const samples = loopRoute(30).map((p) => ({ latitude: p.lat, longitude: p.lon }));
    expect(extractRoute({ gpsTrack: [], samples })).toHaveLength(30);
  });
  it("retourne null sans coordonnées", () => {
    expect(extractRoute({ gpsTrack: [], samples: [] })).toBeNull();
    expect(extractRoute({})).toBeNull();
    expect(extractRoute(null)).toBeNull();
  });
  it("ignore NaN, hors bornes et (0,0), et refuse un tracé réduit à un point ou immobile", () => {
    expect(isValidCoord(0, 0)).toBe(false);
    expect(isValidCoord(91, 0)).toBe(false);
    expect(isValidCoord(NaN, 5)).toBe(false);
    expect(extractRoute({ gpsTrack: [{ lat: 45, lon: 5 }, { lat: NaN, lon: 5 }, { lat: 0, lon: 0 }] })).toBeNull();
    expect(extractRoute({ gpsTrack: [{ lat: 45, lon: 5 }, { lat: 45, lon: 5 }] })).toBeNull();
  });
  it("garde les points valides d'un tracé partiellement corrompu", () => {
    const track = [...loopRoute(20), { lat: NaN, lon: NaN }, { lat: null, lon: undefined }];
    expect(extractRoute({ gpsTrack: track })).toHaveLength(20);
  });
});

describe("tracé — confidentialité, simplification, projection", () => {
  it("trimRouteEnds retire le début et la fin (le point de départ réel disparaît)", () => {
    const route = loopRoute(400);
    const trimmed = trimRouteEnds(route, 300);
    expect(trimmed.length).toBeLessThan(route.length);
    expect(trimmed).not.toContain(route[0]);
    expect(trimmed).not.toContain(route[route.length - 1]);
    expect(routeLengthMeters(trimmed)).toBeLessThan(routeLengthMeters(route));
  });
  it("trimRouteEnds plafonne la coupe à 15 % : une courte sortie reste exploitable", () => {
    const short = loopRoute(60).map((p) => ({ lat: 45 + (p.lat - 45.1234) * 0.02, lon: 5 + (p.lon - 5.4321) * 0.02 }));
    expect(trimRouteEnds(short, 300).length).toBeGreaterThanOrEqual(2);
  });
  it("shareRoute masque les marqueurs quand hidePlaces est actif", () => {
    const r = loopRoute(300);
    expect(shareRoute(r, { hidePlaces: true }).showEndpoints).toBe(false);
    expect(shareRoute(r, { hidePlaces: false }).showEndpoints).toBe(true);
  });
  it("simplifyRoute respecte le plafond et conserve départ/arrivée", () => {
    const r = loopRoute(5000);
    const s = simplifyRoute(r, 150);
    expect(s.length).toBeLessThanOrEqual(150);
    expect(s[0]).toBe(r[0]);
    expect(s[s.length - 1]).toBe(r[r.length - 1]);
  });
  it("projectRoute produit des pixels dans le cadre, marges respectées, sans lat/lon", () => {
    const p = projectRoute(loopRoute(100), { width: 800, height: 480, padding: 50 });
    for (const pt of p.points) {
      expect(pt.x).toBeGreaterThanOrEqual(49.9);
      expect(pt.x).toBeLessThanOrEqual(750.1);
      expect(pt.y).toBeGreaterThanOrEqual(49.9);
      expect(pt.y).toBeLessThanOrEqual(430.1);
      expect(Object.keys(pt).sort()).toEqual(["x", "y"]);
    }
  });
  it("projectRoute renvoie null pour un tracé vide ou d'un seul point", () => {
    expect(projectRoute([], { width: 10, height: 10 })).toBeNull();
    expect(projectRoute([{ lat: 1, lon: 1 }], { width: 10, height: 10 })).toBeNull();
  });
});

describe("noms, tri, filtres", () => {
  const items = [
    act({ id: "1", name: "Col du Galibier", date: "2026-09-01T08:00:00Z", distance: 80, elevationGain: 2100, sportType: "cycling" }),
    act({ id: "2", name: "Boucle forêt", date: "2026-09-15T08:00:00Z", distance: 25, elevationGain: 400, sportType: "mtb" }),
    act({ id: "3", name: "Gravel du dimanche", date: "2026-09-10T08:00:00Z", distance: 60, elevationGain: null, sportType: "gravel" }),
    act({ id: "4", name: null, date: null, distance: 0, elevationGain: 50, sportType: "other" }),
  ];
  it("displayName : surcharge > nom du fichier > libellé neutre", () => {
    expect(displayName(items[0], {})).toBe("Col du Galibier");
    expect(displayName(items[0], { 1: "  Mon Galibier  " })).toBe("Mon Galibier");
    expect(displayName(items[3], {})).toBe("Sortie vélo");
    expect(displayName(items[0], { 1: "   " })).toBe("Col du Galibier");
  });
  it("trie par date (récent d'abord, sans date en dernier)", () => {
    expect(filterAndSortActivities(items, { sort: "date" }).map((a) => a.id)).toEqual(["2", "3", "1", "4"]);
  });
  it("trie par distance (0 km traité comme absent, relégué en fin)", () => {
    expect(filterAndSortActivities(items, { sort: "distance" }).map((a) => a.id)).toEqual(["1", "3", "2", "4"]);
  });
  it("trie par dénivelé (valeur absente en fin, jamais comme 0)", () => {
    expect(filterAndSortActivities(items, { sort: "elevation" }).map((a) => a.id)).toEqual(["1", "2", "4", "3"]);
  });
  it("filtre par type", () => {
    expect(filterAndSortActivities(items, { type: "mtb" }).map((a) => a.id)).toEqual(["2"]);
    expect(filterAndSortActivities(items, { type: "other" }).map((a) => a.id)).toEqual(["4"]);
  });
  it("recherche insensible à la casse, y compris sur un nom modifié", () => {
    expect(filterAndSortActivities(items, { query: "GALIBIER" }).map((a) => a.id)).toEqual(["1"]);
    expect(filterAndSortActivities(items, { query: "ventoux", overrides: { 2: "Ventoux" } }).map((a) => a.id)).toEqual(["2"]);
    expect(filterAndSortActivities(items, { query: "forêt", overrides: { 2: "Ventoux" } })).toEqual([]);
  });
  it("ne modifie pas la liste d'entrée", () => {
    const copy = [...items];
    filterAndSortActivities(items, { sort: "distance" });
    expect(items).toEqual(copy);
  });
  it("availableTypes ne liste que les types présents ; libellés FR", () => {
    expect(availableTypes(items)).toEqual(["cycling", "mtb", "gravel", "other"]);
    expect(availableTypes([items[0]])).toEqual(["cycling"]);
    expect(activityTypeLabel("mtb")).toBe("VTT");
    expect(activityTypeLabel("inconnu")).toBe("Autre");
  });
});

describe("buildStats — données manquantes masquées, jamais à zéro", () => {
  const full = {
    distance: 42.3, movingTime: 6000, duration: 7000, avgSpeed: 25.4, elevationGain: 640,
    avgHeartRate: 148, maxHeartRate: 181, avgCadence: 88, avgPower: 210, maxPower: 780, flags: { powerEstimated: false },
  };
  it("expose les 4 stats principales et les secondaires disponibles", () => {
    const { primary, secondary } = buildStats(full);
    expect(primary.map((s) => s.key)).toEqual(["distance", "movingTime", "avgSpeed", "elevationGain"]);
    expect(secondary.map((s) => s.key)).toEqual(["heartRate", "cadence", "power", "elapsed"]);
    expect(secondary.find((s) => s.key === "heartRate").value).toContain("max");
    expect(secondary.find((s) => s.key === "power").kind).toBe("measured");
  });
  it("cardio et cadence absents → aucune ligne correspondante", () => {
    const { secondary } = buildStats({ ...full, avgHeartRate: null, maxHeartRate: null, avgCadence: null });
    expect(secondary.map((s) => s.key)).toEqual(["power", "elapsed"]);
  });
  it("valeurs à 0 ou absentes ne produisent aucune stat", () => {
    const { primary, secondary } = buildStats({ distance: 0, movingTime: null, avgSpeed: 0, elevationGain: null, avgHeartRate: 0, avgPower: 0 });
    expect(primary).toEqual([]);
    expect(secondary).toEqual([]);
  });
  it("le dénivelé de 0 m reste affiché (valeur réellement calculée)", () => {
    expect(buildStats({ elevationGain: 0 }).primary.map((s) => s.key)).toEqual(["elevationGain"]);
  });
  it("distingue la puissance estimée de la mesurée", () => {
    const est = buildStats({ ...full, flags: { powerEstimated: true } }).secondary.find((s) => s.key === "power");
    expect(est.kind).toBe("estimated");
    expect(est.value.startsWith("≈")).toBe(true);
  });
  it("ne plante pas sur une entrée vide", () => {
    expect(buildStats(null)).toEqual({ primary: [], secondary: [] });
  });
});

describe("elevationProfile", () => {
  const samples = (f) => Array.from({ length: 100 }, (_, i) => ({ altitude: f(i) }));
  it("renvoie un profil réduit avec min/max", () => {
    const p = elevationProfile({ samples: samples((i) => 100 + i * 3), flags: { hasElevation: true } }, 40);
    expect(p.values).toHaveLength(40);
    expect(p.max).toBeGreaterThan(p.min);
  });
  it("null si altitude absente, insuffisante ou plate", () => {
    expect(elevationProfile({ samples: samples(() => null) })).toBeNull();
    expect(elevationProfile({ samples: samples(() => 120) })).toBeNull();
    expect(elevationProfile({ samples: samples((i) => i), flags: { hasElevation: false } })).toBeNull();
    expect(elevationProfile({ samples: [] })).toBeNull();
  });
});

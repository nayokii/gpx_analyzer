import { describe, it, expect } from "vitest";
import { stravaStreamsToPoints, stravaActivityToActivity } from "./adapter.js";
import { StravaMalformedDataError } from "./errors.js";

import activityComplete from "./tests/fixtures/activity-complete.json";
import streamsComplete from "./tests/fixtures/streams-complete.json";
import activityNoHr from "./tests/fixtures/activity-no-hr.json";
import streamsNoHr from "./tests/fixtures/streams-no-hr.json";
import activityNoPower from "./tests/fixtures/activity-no-power.json";
import streamsNoPower from "./tests/fixtures/streams-no-power.json";

describe("stravaStreamsToPoints", () => {
  it("convertit les streams en points {lat, lon, ele, time, hr, cad, power, temp, distanceMeasured, speedMeasured}", () => {
    const points = stravaStreamsToPoints(streamsComplete, activityComplete.start_date);
    expect(points).toHaveLength(streamsComplete.latlng.data.length);

    const first = points[0];
    expect(first.lat).toBe(45.0);
    expect(first.lon).toBe(5.0);
    expect(first.ele).toBe(100);
    expect(first.hr).toBe(95);
    expect(first.cad).toBe(0);
    expect(first.power).toBe(0);
    expect(first.temp).toBe(18);
    expect(first.time).toBeInstanceOf(Date);
    expect(first.time.toISOString()).toBe(new Date(activityComplete.start_date).toISOString());

    const second = points[1];
    const expectedTime = new Date(new Date(activityComplete.start_date).getTime() + 10000);
    expect(second.time.toISOString()).toBe(expectedTime.toISOString());
    expect(second.distanceMeasured).toBeCloseTo(0.062, 5); // 62 m -> km
    expect(second.speedMeasured).toBeCloseTo(6.2 * 3.6, 5); // m/s -> km/h
  });

  it("laisse hr/cad/power/temp à null quand le flux correspondant est totalement absent — n'invente jamais", () => {
    const points = stravaStreamsToPoints(streamsNoHr, activityNoHr.start_date);
    expect(points.every((p) => p.hr === null)).toBe(true);
    expect(points.every((p) => p.temp === null)).toBe(true);
    // cadence et watts sont bien présents dans ce fixture : pas null
    expect(points.some((p) => p.cad != null)).toBe(true);
  });

  it("lève StravaMalformedDataError si le flux latlng est absent (activité non géolocalisée)", () => {
    const { latlng, ...withoutLatlng } = streamsComplete;
    expect(() => stravaStreamsToPoints(withoutLatlng, activityComplete.start_date)).toThrow(StravaMalformedDataError);
  });
});

describe("stravaActivityToActivity", () => {
  it("produit une Activity conforme, avec source.type='strava' et sourceId/athleteId renseignés", () => {
    const activity = stravaActivityToActivity(activityComplete, streamsComplete, { athleteId: 555 });

    expect(activity.source.type).toBe("strava");
    expect(activity.source.sourceId).toBe(String(activityComplete.id));
    expect(activity.source.athleteId).toBe("555");
    expect(activity.source.originalFilename).toBeNull();
    expect(activity.name).toBe(activityComplete.name);
    expect(activity.sportType).toBe("cycling");
    expect(activity.samples).toHaveLength(streamsComplete.time.data.length);
  });

  it("conserve les totaux mesurés Strava (distance/vitesse) séparément des valeurs recalculées", () => {
    const activity = stravaActivityToActivity(activityComplete, streamsComplete, { athleteId: 1 });
    expect(activity.distanceMeasured).toBeCloseTo(activityComplete.distance / 1000, 5);
    expect(activity.avgSpeedMeasured).toBeCloseTo(activityComplete.average_speed * 3.6, 5);
    expect(activity.flags.hasMeasuredDistance).toBe(true);
  });

  it("mappe sport_type 'GravelRide' vers sportType 'gravel'", () => {
    const activity = stravaActivityToActivity(activityNoHr, streamsNoHr, { athleteId: 1 });
    expect(activity.sportType).toBe("gravel");
  });

  it("hr absent chez Strava => flags.hasHeartRate false, jamais une FC inventée", () => {
    const activity = stravaActivityToActivity(activityNoHr, streamsNoHr, { athleteId: 1 });
    expect(activity.flags.hasHeartRate).toBe(false);
    expect(activity.avgHeartRate).toBeNull();
  });

  it("puissance absente chez Strava => le moteur EXISTANT estime (flags.powerEstimated true), l'adaptateur n'invente rien lui-même", () => {
    const activity = stravaActivityToActivity(activityNoPower, streamsNoPower, { athleteId: 1, userSettings: { weight: 75, bikeWeight: 8 } });
    expect(activity.flags.powerEstimated).toBe(true);
    expect(activity.avgPower).not.toBeNull(); // estimé par computeAnalysis, pas par l'adaptateur
  });

  it("puissance mesurée chez Strava => jamais marquée comme estimée", () => {
    const activity = stravaActivityToActivity(activityComplete, streamsComplete, { athleteId: 1 });
    expect(activity.flags.powerEstimated).toBe(false);
    expect(activity.flags.hasPower).toBe(true);
  });

  it("rejette un type d'activité Strava non cycliste (ex. Run)", () => {
    const run = { ...activityComplete, id: 4444, sport_type: "Run", type: "Run" };
    expect(() => stravaActivityToActivity(run, streamsComplete, { athleteId: 1 })).toThrow(StravaMalformedDataError);
  });

  it("rejette une activité sans id ou sans start_date", () => {
    expect(() => stravaActivityToActivity({ ...activityComplete, id: undefined }, streamsComplete, {})).toThrow(StravaMalformedDataError);
    expect(() => stravaActivityToActivity({ ...activityComplete, start_date: undefined }, streamsComplete, {})).toThrow(StravaMalformedDataError);
  });
});

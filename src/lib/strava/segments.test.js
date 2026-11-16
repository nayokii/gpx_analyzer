import { describe, it, expect, vi } from "vitest";
import { boundsAround, pickSegmentForClimb, findStravaSegmentsForClimbs } from "./segments.js";
import { StravaRateLimitError } from "./errors.js";

const climb = { startLat: 45.0, startLon: 6.0, endLat: 45.01, endLon: 6.0, path: [[45.0, 6.0], [45.005, 6.001], [45.01, 6.0]] };
const seg = (id, name, dStart = 0, dEnd = 0) => ({
  id, name, climb_category: 2, start_latlng: [45.0 + dStart, 6.0], end_latlng: [45.01 + dEnd, 6.0],
});

describe("boundsAround", () => {
  it("englobe le tracé avec une marge", () => {
    const [s, w, n, e] = boundsAround(climb.path);
    expect(s).toBeLessThan(45.0);
    expect(n).toBeGreaterThan(45.01);
    expect(w).toBeLessThan(6.0);
    expect(e).toBeGreaterThan(6.001);
    expect(boundsAround([])).toBeNull();
  });
});

describe("pickSegmentForClimb", () => {
  it("retient le segment dont départ et arrivée collent à la montée, le plus proche d'abord", () => {
    const picked = pickSegmentForClimb([seg(1, "Loin", 0.01), seg(2, "Presque", 0.0005), seg(3, "Exact")], climb);
    expect(picked).toEqual({ id: 3, name: "Exact", category: 2 });
  });
  it("aucun segment compatible : null (un segment qui ne couvre que le haut ne compte pas)", () => {
    expect(pickSegmentForClimb([seg(1, "Haut", 0.006)], climb)).toBeNull();
    expect(pickSegmentForClimb([], climb)).toBeNull();
  });
});

describe("findStravaSegmentsForClimbs", () => {
  const state = { connected: true, tokens: { accessToken: "tok", refreshToken: "r", expiresAt: Date.now() / 1000 + 3600, scope: "read,activity:read" } };
  const group = { id: "g1", ...climb };
  const jsonRes = (body) => ({ ok: true, status: 200, json: async () => body });

  it("interroge Strava par montée et renvoie les correspondances", async () => {
    const fetchImpl = vi.fn(async () => jsonRes({ segments: [seg(7, "Col du Test")] }));
    const out = await findStravaSegmentsForClimbs({ rootHandle: null, state, groups: [group], fetchImpl });
    expect(out.matches).toHaveLength(1);
    expect(out.matches[0].segment.name).toBe("Col du Test");
    expect(out.rateLimited).toBe(false);
    expect(fetchImpl.mock.calls[0][0]).toContain("/segments/explore?bounds=");
  });

  it("s'arrête proprement à la limite de requêtes en gardant ce qui a été trouvé", async () => {
    let calls = 0;
    const fetchImpl = vi.fn(async () => {
      calls += 1;
      if (calls === 1) return jsonRes({ segments: [seg(7, "Col du Test")] });
      return { ok: false, status: 429, headers: { get: () => "60" }, json: async () => ({}) };
    });
    const out = await findStravaSegmentsForClimbs({ rootHandle: null, state, groups: [group, { ...group, id: "g2" }], fetchImpl });
    expect(out.rateLimited).toBe(true);
    expect(out.matches).toHaveLength(1);
  });

  it("refuse si Strava n'est pas connecté", async () => {
    await expect(findStravaSegmentsForClimbs({ rootHandle: null, state: { connected: false, tokens: null }, groups: [group] })).rejects.toThrow();
  });
});

import { describe, it, expect, vi } from "vitest";
import { listAthleteActivities, listAllAthleteActivities, getActivityStreams, STREAM_KEYS } from "./api.js";
import { StravaTokenExpiredError, StravaRateLimitError, StravaApiUnavailableError, StravaActivityUnavailableError } from "./errors.js";

import activitiesPage1 from "./tests/fixtures/activities-page1.json";
import activitiesPage2 from "./tests/fixtures/activities-page2.json";
import streamsComplete from "./tests/fixtures/streams-complete.json";
import error401 from "./tests/fixtures/api-error-401.json";
import error429 from "./tests/fixtures/api-error-429.json";

function jsonResponse(status, body, headers = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name) => headers[name] ?? null },
    json: async () => body,
  };
}

describe("listAthleteActivities", () => {
  it("appelle /athlete/activities avec pagination et transmet le jeton en Bearer", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(200, activitiesPage1));
    const result = await listAthleteActivities({ accessToken: "tok-1", page: 1, perPage: 2, fetchImpl });

    expect(result).toEqual(activitiesPage1);
    const [url, options] = fetchImpl.mock.calls[0];
    expect(url).toContain("/athlete/activities");
    expect(url).toContain("page=1");
    expect(url).toContain("per_page=2");
    expect(options.headers.Authorization).toBe("Bearer tok-1");
  });

  it("transmet le paramètre 'after' pour une synchro incrémentale", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(200, []));
    await listAthleteActivities({ accessToken: "tok-1", after: 1717200000, fetchImpl });
    expect(fetchImpl.mock.calls[0][0]).toContain("after=1717200000");
  });

  it("lève StravaTokenExpiredError sur 401", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(401, error401));
    await expect(listAthleteActivities({ accessToken: "expired", fetchImpl })).rejects.toThrow(StravaTokenExpiredError);
  });

  it("lève StravaRateLimitError sur 429, en lisant Retry-After", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(429, error429, { "Retry-After": "120" }));
    await expect(listAthleteActivities({ accessToken: "tok-1", fetchImpl })).rejects.toThrow(StravaRateLimitError);
    try {
      await listAthleteActivities({ accessToken: "tok-1", fetchImpl });
    } catch (err) {
      expect(err.retryAfterSeconds).toBe(120);
    }
  });

  it("lève StravaApiUnavailableError sur une erreur serveur générique (5xx)", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(500, { message: "Internal error" }));
    await expect(listAthleteActivities({ accessToken: "tok-1", fetchImpl })).rejects.toThrow(StravaApiUnavailableError);
  });
});

describe("listAllAthleteActivities (pagination automatique)", () => {
  it("s'arrête dès qu'une page renvoie moins que perPage (fin de liste)", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(200, activitiesPage1)) // 2 items == perPage : encore une page
      .mockResolvedValueOnce(jsonResponse(200, activitiesPage2)); // 1 item < perPage : dernière page

    const all = await listAllAthleteActivities({ accessToken: "tok-1", perPage: 2, fetchImpl });

    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(all).toHaveLength(activitiesPage1.length + activitiesPage2.length);
  });

  it("appelle onPage à chaque page reçue, pour une future barre de progression", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(200, activitiesPage1))
      .mockResolvedValueOnce(jsonResponse(200, activitiesPage2));
    const onPage = vi.fn();

    await listAllAthleteActivities({ accessToken: "tok-1", perPage: 2, fetchImpl, onPage });

    expect(onPage).toHaveBeenCalledTimes(2);
    expect(onPage).toHaveBeenNthCalledWith(1, activitiesPage1, 1);
  });
});

describe("getActivityStreams", () => {
  it("demande exactement les clés STREAM_KEYS et key_by_type=true", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(200, streamsComplete));
    const streams = await getActivityStreams({ accessToken: "tok-1", activityId: 1111111111, fetchImpl });

    expect(streams).toEqual(streamsComplete);
    const url = new URL(fetchImpl.mock.calls[0][0]);
    expect(url.pathname).toContain("/activities/1111111111/streams");
    expect(url.searchParams.get("keys")).toBe(STREAM_KEYS.join(","));
    expect(url.searchParams.get("key_by_type")).toBe("true");
  });

  it("lève StravaActivityUnavailableError sur 404 (activité supprimée/privée)", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(404, { message: "Record Not Found" }));
    await expect(getActivityStreams({ accessToken: "tok-1", activityId: 999, fetchImpl })).rejects.toThrow(StravaActivityUnavailableError);
  });

  it("ne renvoie que les flux présents dans la réponse — n'invente jamais un flux absent", async () => {
    const partial = { time: streamsComplete.time, latlng: streamsComplete.latlng };
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(200, partial));
    const streams = await getActivityStreams({ accessToken: "tok-1", activityId: 1, fetchImpl });
    expect(streams.watts).toBeUndefined();
    expect(streams.heartrate).toBeUndefined();
  });
});

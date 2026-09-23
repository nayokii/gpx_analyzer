import { describe, it, expect } from "vitest";
import { syncStrava, isProbableDuplicate } from "./sync.js";
import { loadStravaState } from "./storage.js";
import { listActivities } from "../storage/activityStore.js";
import { MemoryDirectoryHandle } from "../storage/testFsHandle.js";

import activityComplete from "./tests/fixtures/activity-complete.json";
import streamsComplete from "./tests/fixtures/streams-complete.json";
import activityNoHr from "./tests/fixtures/activity-no-hr.json";
import streamsNoHr from "./tests/fixtures/streams-no-hr.json";

const RUN_ACTIVITY = { id: 9999, name: "Footing", sport_type: "Run", type: "Run", start_date: "2026-06-04T09:00:00Z", distance: 8000, average_speed: 3.0, max_speed: 4.0 };

function makeFetchImpl({ activities, streamsById = {}, refreshResponse = null }) {
  return async (url) => {
    const u = String(url);
    if (u.includes("/.netlify/functions/strava-refresh")) {
      return { ok: true, status: 200, json: async () => refreshResponse };
    }
    if (u.includes("/athlete/activities")) {
      return { ok: true, status: 200, headers: { get: () => null }, json: async () => activities };
    }
    const streamsMatch = u.match(/\/activities\/(\d+)\/streams/);
    if (streamsMatch) {
      const id = streamsMatch[1];
      if (!(id in streamsById)) {
        return { ok: false, status: 404, headers: { get: () => null }, json: async () => ({ message: "Not Found" }) };
      }
      return { ok: true, status: 200, headers: { get: () => null }, json: async () => streamsById[id] };
    }
    throw new Error("URL inattendue dans le test : " + u);
  };
}

function freshState(overrides = {}) {
  const farFuture = Date.now() / 1000 + 3600;
  return {
    version: 1,
    connected: true,
    tokens: { accessToken: "tok-1", refreshToken: "ref-1", expiresAt: farFuture, scope: "activity:read" },
    athlete: { id: 555 },
    connectedAt: new Date().toISOString(),
    lastSyncAt: null,
    syncCursor: null,
    importedStravaIds: [],
    lastSyncSummary: null,
    ...overrides,
  };
}

describe("isProbableDuplicate", () => {
  it("détecte un doublon quand date+distance sont dans la tolérance", () => {
    const stravaSummary = { start_date: "2026-06-01T06:00:00Z", distance: 20500 };
    const existing = [{ date: "2026-06-01T06:00:30Z", distance: 20.4 }];
    expect(isProbableDuplicate(stravaSummary, existing)).toBe(true);
  });

  it("ne détecte PAS de doublon hors tolérance — ne jamais ignorer par excès de prudence", () => {
    const stravaSummary = { start_date: "2026-06-01T06:00:00Z", distance: 20500 };
    const existing = [{ date: "2026-06-01T09:00:00Z", distance: 5 }];
    expect(isProbableDuplicate(stravaSummary, existing)).toBe(false);
  });
});

describe("syncStrava — première importation", () => {
  it("importe les activités cyclistes, ignore les non-cyclistes, avance le curseur sur la plus récente vue (même ignorée)", async () => {
    const rootHandle = new MemoryDirectoryHandle();
    const activities = [activityComplete, activityNoHr, RUN_ACTIVITY];
    const fetchImpl = makeFetchImpl({
      activities,
      streamsById: { [String(activityComplete.id)]: streamsComplete, [String(activityNoHr.id)]: streamsNoHr },
    });

    const { state, summary } = await syncStrava({
      rootHandle,
      state: freshState(),
      existingSummaries: [],
      userSettings: { weight: 75, bikeWeight: 8 },
      fetchImpl,
    });

    expect(summary.imported).toBe(2);
    expect(summary.skippedNonCycling).toBe(1);
    expect(summary.skippedDuplicates).toBe(0);
    expect(summary.errors).toHaveLength(0);

    const saved = await listActivities(rootHandle);
    expect(saved).toHaveLength(2);
    expect(saved.every((a) => a.source.type === "strava")).toBe(true);

    const expectedCursor = Math.floor(new Date(RUN_ACTIVITY.start_date).getTime() / 1000);
    expect(state.syncCursor).toBe(expectedCursor);
    expect(state.importedStravaIds).toContain(String(activityComplete.id));
    expect(state.importedStravaIds).toContain(String(activityNoHr.id));

    const persisted = await loadStravaState(rootHandle);
    expect(persisted.lastSyncAt).toBeTruthy();
  });
});

describe("syncStrava — déduplication", () => {
  it("ignore une activité déjà importée (même id Strava déjà connu)", async () => {
    const rootHandle = new MemoryDirectoryHandle();
    const fetchImpl = makeFetchImpl({ activities: [activityComplete], streamsById: { [String(activityComplete.id)]: streamsComplete } });

    const { summary } = await syncStrava({
      rootHandle,
      state: freshState({ importedStravaIds: [String(activityComplete.id)] }),
      existingSummaries: [],
      fetchImpl,
    });

    expect(summary.imported).toBe(0);
    expect(summary.skippedDuplicates).toBe(1);
  });

  it("ignore une activité qui correspond (date+distance) à une sortie déjà en historique (ex. importée en FIT), sans jamais la supprimer", async () => {
    const rootHandle = new MemoryDirectoryHandle();
    const fetchImpl = makeFetchImpl({ activities: [activityComplete], streamsById: { [String(activityComplete.id)]: streamsComplete } });
    const existingSummaries = [{ id: "local-fit-1", date: activityComplete.start_date, distance: activityComplete.distance / 1000, source: { type: "fit" } }];

    const { summary } = await syncStrava({ rootHandle, state: freshState(), existingSummaries, fetchImpl });

    expect(summary.imported).toBe(0);
    expect(summary.skippedDuplicates).toBe(1);
    const saved = await listActivities(rootHandle);
    expect(saved).toHaveLength(0); // rien de nouveau écrit, et l'existant (hors de ce dossier de test) reste intact
  });
});

describe("syncStrava — erreur partielle", () => {
  it("consigne l'échec d'une activité (flux indisponible) sans interrompre les suivantes", async () => {
    const rootHandle = new MemoryDirectoryHandle();
    // activityNoHr n'a pas de streams fournis dans le mock -> 404 simulé
    const activities = [activityComplete, activityNoHr];
    const fetchImpl = makeFetchImpl({ activities, streamsById: { [String(activityComplete.id)]: streamsComplete } });

    const { summary } = await syncStrava({ rootHandle, state: freshState(), existingSummaries: [], fetchImpl });

    expect(summary.imported).toBe(1);
    expect(summary.errors).toHaveLength(1);
    expect(summary.errors[0].activityId).toBe(activityNoHr.id);

    const saved = await listActivities(rootHandle);
    expect(saved).toHaveLength(1);
  });
});

describe("syncStrava — synchronisation incrémentale", () => {
  it("transmet syncCursor comme paramètre 'after' à l'API (pas de re-téléchargement complet)", async () => {
    const rootHandle = new MemoryDirectoryHandle();
    let capturedUrl = null;
    const fetchImpl = async (url) => {
      capturedUrl = String(url);
      return { ok: true, status: 200, headers: { get: () => null }, json: async () => [] };
    };

    await syncStrava({ rootHandle, state: freshState({ syncCursor: 1717200000 }), existingSummaries: [], fetchImpl });

    expect(capturedUrl).toContain("after=1717200000");
  });
});

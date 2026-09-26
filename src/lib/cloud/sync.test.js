import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { __setSupabaseClientForTests } from "./client.js";
import { uploadActivity } from "./sync.js";
import { downloadActivityFile } from "./files.js";
import { listCloudActivities } from "./activities.js";
import { CloudDuplicateActivityError, CloudUnsupportedSourceError } from "./errors.js";
import { createFakeSupabaseBackend } from "./tests/fakeSupabase.js";

function localActivity(overrides = {}) {
  return {
    id: "local-abc123",
    name: "Sortie du dimanche",
    date: "2026-09-20T08:00:00.000Z",
    sportType: "cycling",
    source: { type: "gpx", originalFilename: "sortie.gpx", storedFilename: "2026-09-20_local-abc123.gpx", sourceId: null, athleteId: null },
    distance: 42.5,
    duration: 5400,
    movingTime: 5100,
    elevationGain: 320,
    elevationLoss: 310,
    avgSpeed: 28.3,
    avgPower: 180,
    avgCadence: 82,
    flags: { hasGps: true, hasPower: true },
    ...overrides,
  };
}

describe("cloud/sync: uploadActivity", () => {
  let backend;

  beforeEach(() => {
    backend = createFakeSupabaseBackend();
    __setSupabaseClientForTests(backend.client);
  });

  afterEach(() => {
    __setSupabaseClientForTests(null);
  });

  it("crée l'activité cloud ET le fichier original en une seule opération", async () => {
    await backend.signUpAndLogin("a@example.com");
    const gpxContent = "<gpx>contenu de test</gpx>";

    const created = await uploadActivity({ activity: localActivity(), originalFileContent: gpxContent, sourceFormat: "gpx" });

    expect(created.sourceFormat).toBe("gpx");
    expect(created.distance).toBe(42.5);
    expect(await listCloudActivities()).toHaveLength(1);

    const downloaded = await downloadActivityFile({ activityId: created.id, ext: "gpx" });
    expect(downloaded).toBe(gpxContent);
  });

  it("un format source non pris en charge (ex. 'strava') lève CloudUnsupportedSourceError sans rien créer", async () => {
    await backend.signUpAndLogin("a@example.com");
    await expect(
      uploadActivity({ activity: localActivity({ source: { type: "strava" } }), originalFileContent: "{}", sourceFormat: "strava" })
    ).rejects.toThrow(CloudUnsupportedSourceError);
    expect(await listCloudActivities()).toHaveLength(0);
  });

  it("uploader deux fois le même fichier lève CloudDuplicateActivityError et ne crée qu'une seule activité", async () => {
    await backend.signUpAndLogin("a@example.com");
    const gpxContent = "<gpx>contenu identique</gpx>";

    const first = await uploadActivity({ activity: localActivity(), originalFileContent: gpxContent, sourceFormat: "gpx" });

    let caught = null;
    try {
      await uploadActivity({ activity: localActivity({ id: "local-def456" }), originalFileContent: gpxContent, sourceFormat: "gpx" });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(CloudDuplicateActivityError);
    expect(caught.existingActivity.id).toBe(first.id);
    expect(await listCloudActivities()).toHaveLength(1);
  });

  it("deux fichiers de contenu différent (donc de hash différent) créent bien deux activités", async () => {
    await backend.signUpAndLogin("a@example.com");
    await uploadActivity({ activity: localActivity({ id: "local-1" }), originalFileContent: "<gpx>A</gpx>", sourceFormat: "gpx" });
    await uploadActivity({ activity: localActivity({ id: "local-2" }), originalFileContent: "<gpx>B</gpx>", sourceFormat: "gpx" });
    expect(await listCloudActivities()).toHaveLength(2);
  });

  it("deux synchronisations concurrentes du même fichier n'aboutissent qu'une seule fois (course gérée par la contrainte unique)", async () => {
    await backend.signUpAndLogin("a@example.com");
    const gpxContent = "<gpx>course</gpx>";

    const results = await Promise.allSettled([
      uploadActivity({ activity: localActivity({ id: "local-race-1" }), originalFileContent: gpxContent, sourceFormat: "gpx" }),
      uploadActivity({ activity: localActivity({ id: "local-race-2" }), originalFileContent: gpxContent, sourceFormat: "gpx" }),
    ]);

    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r) => r.status === "rejected");
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(rejected[0].reason).toBeInstanceOf(CloudDuplicateActivityError);
    expect(await listCloudActivities()).toHaveLength(1);
  });
});

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { __setSupabaseClientForTests } from "./client.js";
import {
  listCloudActivities,
  getCloudActivity,
  findCloudActivityByHash,
  createCloudActivity,
  deleteCloudActivity,
} from "./activities.js";
import { CloudNotAuthenticatedError, CloudApiError } from "./errors.js";
import { createFakeSupabaseBackend } from "./tests/fakeSupabase.js";

function sampleRow(overrides = {}) {
  return {
    local_id: "local-1",
    source_type: "local_upload",
    source_file_name: "sortie.gpx",
    source_format: "gpx",
    file_hash: "a".repeat(64),
    started_at: "2026-09-20T08:00:00.000Z",
    distance: 42.5,
    duration: 5400,
    moving_time: 5100,
    elevation_gain: 320,
    elevation_loss: 310,
    avg_speed: 28.3,
    avg_power: 180,
    avg_cadence: 82,
    flags: { hasGps: true },
    ...overrides,
  };
}

describe("cloud/activities", () => {
  let backend;

  beforeEach(() => {
    backend = createFakeSupabaseBackend();
    __setSupabaseClientForTests(backend.client);
  });

  afterEach(() => {
    __setSupabaseClientForTests(null);
  });

  it("toute opération sans session lève CloudNotAuthenticatedError", async () => {
    await expect(listCloudActivities()).rejects.toThrow(CloudNotAuthenticatedError);
    await expect(getCloudActivity("whatever")).rejects.toThrow(CloudNotAuthenticatedError);
    await expect(createCloudActivity(sampleRow())).rejects.toThrow(CloudNotAuthenticatedError);
    await expect(deleteCloudActivity("whatever")).rejects.toThrow(CloudNotAuthenticatedError);
  });

  it("createCloudActivity() puis listCloudActivities() retrouve l'activité créée", async () => {
    await backend.signUpAndLogin("a@example.com");
    const created = await createCloudActivity(sampleRow());
    expect(created.id).toBeTruthy();
    expect(created.distance).toBe(42.5);

    const list = await listCloudActivities();
    expect(list).toHaveLength(1);
    expect(list[0].id).toBe(created.id);
  });

  it("createCloudActivity() ignore un user_id fourni par l'appelant (jamais de preuve d'autorisation par le frontend)", async () => {
    const userA = await backend.signUpAndLogin("a@example.com");
    const created = await createCloudActivity(sampleRow({ user_id: "id-arbitraire-fabrique" }));
    expect(created.userId).toBe(userA.id);
    expect(created.userId).not.toBe("id-arbitraire-fabrique");
  });

  it("deux fichiers de hash différent créent deux activités distinctes", async () => {
    await backend.signUpAndLogin("a@example.com");
    await createCloudActivity(sampleRow({ file_hash: "a".repeat(64) }));
    await createCloudActivity(sampleRow({ file_hash: "b".repeat(64) }));
    expect(await listCloudActivities()).toHaveLength(2);
  });

  it("le même hash pour le même utilisateur viole la contrainte unique (code 'duplicate')", async () => {
    await backend.signUpAndLogin("a@example.com");
    await createCloudActivity(sampleRow({ file_hash: "c".repeat(64) }));
    let caught = null;
    try {
      await createCloudActivity(sampleRow({ file_hash: "c".repeat(64) }));
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(CloudApiError);
    expect(caught.code).toBe("duplicate");
    expect(await listCloudActivities()).toHaveLength(1);
  });

  it("findCloudActivityByHash() retrouve une activité par empreinte, et renvoie null si absente", async () => {
    await backend.signUpAndLogin("a@example.com");
    await createCloudActivity(sampleRow({ file_hash: "d".repeat(64) }));
    expect(await findCloudActivityByHash("d".repeat(64))).not.toBeNull();
    expect(await findCloudActivityByHash("e".repeat(64))).toBeNull();
  });

  describe("isolation entre utilisateurs (voir consigne §7/§20)", () => {
    it("l'utilisateur A ne voit jamais les activités de l'utilisateur B dans sa liste", async () => {
      await backend.signUpAndLogin("a@example.com");
      const activityA = await createCloudActivity(sampleRow({ file_hash: "1".repeat(64) }));

      await backend.signUpAndLogin("b@example.com");
      const activityB = await createCloudActivity(sampleRow({ file_hash: "2".repeat(64) }));

      const listAsB = await listCloudActivities();
      expect(listAsB.map((a) => a.id)).toEqual([activityB.id]);
      expect(listAsB.map((a) => a.id)).not.toContain(activityA.id);
    });

    it("l'utilisateur A ne peut pas lire une activité de l'utilisateur B par son id (renvoie null, jamais les données de B)", async () => {
      await backend.signUpAndLogin("a@example.com");
      const activityA = await createCloudActivity(sampleRow({ file_hash: "3".repeat(64) }));

      await backend.signUpAndLogin("b@example.com");
      expect(await getCloudActivity(activityA.id)).toBeNull();
    });

    it("l'utilisateur A ne peut pas supprimer une activité de l'utilisateur B", async () => {
      await backend.signUpAndLogin("a@example.com");
      const activityA = await createCloudActivity(sampleRow({ file_hash: "4".repeat(64) }));

      await backend.signUpAndLogin("b@example.com");
      await deleteCloudActivity(activityA.id); // ne doit lever aucune erreur (RLS : 0 ligne affectée, silencieux)

      // Vérification directe sur le magasin interne du fake (contourne
      // volontairement la session courante) : la ligne de A doit toujours exister.
      expect(backend._debug.activitiesTable.some((r) => r.id === activityA.id)).toBe(true);
    });
  });
});

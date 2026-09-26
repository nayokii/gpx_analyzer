import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { __setSupabaseClientForTests } from "./client.js";
import { uploadActivityFile, downloadActivityFile, deleteActivityFile } from "./files.js";
import { CloudNotAuthenticatedError, CloudStorageError } from "./errors.js";
import { createFakeSupabaseBackend } from "./tests/fakeSupabase.js";

describe("cloud/files", () => {
  let backend;

  beforeEach(() => {
    backend = createFakeSupabaseBackend();
    __setSupabaseClientForTests(backend.client);
  });

  afterEach(() => {
    __setSupabaseClientForTests(null);
  });

  it("toute opération sans session lève CloudNotAuthenticatedError", async () => {
    await expect(uploadActivityFile({ activityId: "a1", ext: "gpx", content: "<gpx/>" })).rejects.toThrow(CloudNotAuthenticatedError);
    await expect(downloadActivityFile({ activityId: "a1", ext: "gpx" })).rejects.toThrow(CloudNotAuthenticatedError);
    await expect(deleteActivityFile({ activityId: "a1", ext: "gpx" })).rejects.toThrow(CloudNotAuthenticatedError);
  });

  it("upload puis download d'un GPX (texte) restitue le contenu exact", async () => {
    await backend.signUpAndLogin("a@example.com");
    const gpxContent = "<?xml version=\"1.0\"?><gpx></gpx>";
    const path = await uploadActivityFile({ activityId: "activity-1", ext: "gpx", content: gpxContent });
    expect(path).toMatch(/\/activity-1\.gpx$/);

    const downloaded = await downloadActivityFile({ activityId: "activity-1", ext: "gpx" });
    expect(downloaded).toBe(gpxContent);
  });

  it("upload puis download d'un FIT (binaire) restitue les mêmes octets", async () => {
    await backend.signUpAndLogin("a@example.com");
    const bytes = new Uint8Array([0x0e, 0x10, 0x43, 0xff, 0x00, 0x01]);
    await uploadActivityFile({ activityId: "activity-2", ext: "fit", content: bytes.buffer });

    const downloaded = await downloadActivityFile({ activityId: "activity-2", ext: "fit" });
    expect(new Uint8Array(downloaded)).toEqual(bytes);
  });

  it("deleteActivityFile() supprime le fichier : un download suivant échoue", async () => {
    await backend.signUpAndLogin("a@example.com");
    await uploadActivityFile({ activityId: "activity-3", ext: "gpx", content: "<gpx/>" });
    await deleteActivityFile({ activityId: "activity-3", ext: "gpx" });

    await expect(downloadActivityFile({ activityId: "activity-3", ext: "gpx" })).rejects.toThrow(CloudStorageError);
  });

  it("un chemin de fichier invalide au moment de l'upload (préfixe utilisateur incorrect simulé) est refusé", async () => {
    await backend.signUpAndLogin("a@example.com");
    // Impossible de fabriquer un mauvais chemin via l'API publique (activityFilePath
    // construit toujours <user.id>/...) — ce test documente que la policy Storage
    // s'appuie sur le PREMIER segment du chemin, jamais sur une donnée fournie
    // par ailleurs par l'appelant, en le vérifiant directement sur le fake.
    const result = await backend.client.storage.from("activity-files").upload("un-autre-id/activity.gpx", "<gpx/>", {});
    expect(result.error).toBeTruthy();
  });

  describe("isolation entre utilisateurs (voir consigne §7/§20)", () => {
    it("l'utilisateur A ne peut pas télécharger un fichier appartenant à l'utilisateur B", async () => {
      await backend.signUpAndLogin("a@example.com");
      await uploadActivityFile({ activityId: "shared-id", ext: "gpx", content: "<gpx>a</gpx>" });

      await backend.signUpAndLogin("b@example.com");
      // B a son propre chemin (préfixé par son propre user.id) : tenter de lire
      // le même activityId ne peut de toute façon pas atteindre le fichier de A,
      // puisque le chemin réel de A commence par l'id de A, pas celui de B.
      await expect(downloadActivityFile({ activityId: "shared-id", ext: "gpx" })).rejects.toThrow(CloudStorageError);
    });
  });
});

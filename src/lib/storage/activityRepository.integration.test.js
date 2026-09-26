/**
 * Scénario d'intégration critique — Phase 11B, consigne §30 :
 *
 *   1. créer un utilisateur simulé
 *   2. créer 2 activités locales
 *   3. synchroniser
 *   4. vider le cache local (ici : un second appareil, dossier local neuf)
 *   5. récupérer les activités cloud
 *   6. reconstruire les Activity
 *   7. calculer Profile
 *   8. calculer Progression
 *   9. calculer Archetype
 *   10. lancer Tour
 *
 * Le résultat doit fonctionner SANS les fichiers locaux d'origine — vérifié
 * ici en n'utilisant, à partir de l'étape 4, plus jamais `deviceOneRoot`.
 * Aucun moteur métier n'est modifié ni contourné (voir consigne §31) :
 * `computeCyclistProfile`/`computeProgression`/`matchArchetypes`/
 * `simulateTour` sont les fonctions RÉELLES, appelées exactement comme le
 * ferait une vue de l'application.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";

import { MemoryDirectoryHandle } from "./testFsHandle.js";
import { listActivities as localListActivities } from "./activityStore.js";
import { createActivityRepository, __resetSyncCoordinatorForTests } from "./activityRepository.js";
import { clearQueue } from "./syncQueue.js";
import { __setSupabaseClientForTests } from "../cloud/client.js";
import { createFakeSupabaseBackend } from "../cloud/tests/fakeSupabase.js";
import { parseGPXString } from "../parsers/gpxParser.js";
import { computeAnalysis } from "../analysis.js";
import { toActivity } from "../normalize.js";
import { computeCyclistProfile } from "../profile/profile.js";
import { computeProgression } from "../progression/progression.js";
import { matchArchetypes } from "../archetypes/matching.js";
import { simulateTour, createGenericTour } from "../simulator/index.js";

function gpxWithPoints(dayOffset) {
  const pts = [];
  for (let i = 0; i < 10; i++) {
    const minute = String(i).padStart(2, "0");
    pts.push(
      `<trkpt lat="45.0${dayOffset}${i}" lon="5.0${dayOffset}${i}"><ele>${200 + i * 6}</ele><time>2026-09-2${dayOffset}T08:${minute}:00Z</time></trkpt>`
    );
  }
  return `<?xml version="1.0"?><gpx><trk><name>ride-${dayOffset}</name><trkseg>${pts.join("")}</trkseg></trk></gpx>`;
}

function buildActivityFromGpx(name, gpxContent) {
  const { points } = parseGPXString(gpxContent);
  const analysis = computeAnalysis(points, { weight: 75, bikeWeight: 8 });
  return toActivity(analysis, points, { name, sourceType: "gpx", originalFilename: `${name}.gpx` });
}

beforeEach(() => {
  clearQueue();
  __resetSyncCoordinatorForTests();
});

afterEach(() => {
  __setSupabaseClientForTests(null);
  __resetSyncCoordinatorForTests();
});

describe("Scénario critique §30 — pipeline complet depuis le cloud, sans les fichiers locaux d'origine", () => {
  it("Profile / Progression / Archetype / Tour fonctionnent après un vidage du cache local", async () => {
    const backend = createFakeSupabaseBackend();
    __setSupabaseClientForTests(backend.client);

    // 1) Utilisateur simulé.
    const user = await backend.signUpAndLogin("integration@example.com");

    // 2) Deux activités locales, sur un premier appareil.
    const deviceOneRoot = new MemoryDirectoryHandle();
    const repoDeviceOne = createActivityRepository({ rootHandle: deviceOneRoot, cloudUser: user });

    const gpxA = gpxWithPoints(0);
    const gpxB = gpxWithPoints(1);
    const savedA = await repoDeviceOne.saveActivity(buildActivityFromGpx("ride-A", gpxA), gpxA, "gpx");
    const savedB = await repoDeviceOne.saveActivity(buildActivityFromGpx("ride-B", gpxB), gpxB, "gpx");
    // L'upload cloud se fait en arrière-plan depuis la Phase 11C (voir
    // saveActivity()) : on l'attend explicitement ici pour tester ensuite un
    // sync() qui ne trouve plus rien à envoyer (déjà synchronisées).
    await Promise.all([savedA.cloudSyncPromise, savedB.cloudSyncPromise]);

    // 3) Synchronisation explicite (déjà à jour via saveActivity ici, mais
    //    l'action est exercée pour de vrai, comme le bouton "Synchroniser").
    const syncResult = await repoDeviceOne.sync({ force: true });
    expect(syncResult.errors).toEqual([]);
    expect(syncResult.alreadySynced).toBe(2);

    // 4) "Vider le cache local" : un second appareil, avec un dossier local
    //    ENTIÈREMENT NEUF (jamais vu ces fichiers) — deviceOneRoot n'est plus
    //    jamais référencé après cette ligne.
    const deviceTwoRoot = new MemoryDirectoryHandle();
    const repoDeviceTwo = createActivityRepository({ rootHandle: deviceTwoRoot, cloudUser: user });

    // 5) Récupérer les activités cloud.
    const { items, source } = await repoDeviceTwo.listActivities();
    expect(source).toBe("cloud");
    expect(items).toHaveLength(2);
    expect(items.every((i) => i.syncStatus === "cloud-only")).toBe(true);

    // 6) Reconstruire les Activity (téléchargement + reparse, voir
    //    activityRepository.js: materializeFromCloud) — jamais les fichiers
    //    locaux d'origine, qui n'existent pas sur cet appareil.
    const details = await Promise.all(items.map((i) => repoDeviceTwo.loadActivityDetail(i.id)));
    expect(details).toHaveLength(2);
    for (const d of details) expect(d.samples.length).toBeGreaterThan(0);

    // 7) Profile — moteur RÉEL, inchangé.
    const profile = computeCyclistProfile(details);
    expect(profile.activityCount).toBe(2);

    // 8) Progression — moteur RÉEL, inchangé.
    const progression = computeProgression(details, profile);
    expect(progression.activityCount).toBe(2);

    // 9) Archetype — moteur RÉEL, inchangé.
    const archetypeMatch = matchArchetypes(profile);
    expect(archetypeMatch).toBeTruthy();
    expect(typeof archetypeMatch.combinedLabel).toBe("string");

    // 10) Tour Simulator — moteur 10A RÉEL, inchangé, consomme le même profil.
    const stages = createGenericTour();
    const { stageResults, overall } = simulateTour({ profile, stages, seed: "integration-seed" });
    expect(stageResults).toHaveLength(stages.length);
    expect(overall).toBeTruthy();

    // Effet de bord attendu (voir consigne §26/§27 : mise en cache après
    // matérialisation) : le second appareil a maintenant les deux activités
    // localement, sans jamais avoir touché aux fichiers du premier appareil.
    const localAfter = await localListActivities(deviceTwoRoot);
    expect(localAfter).toHaveLength(2);
  });
});

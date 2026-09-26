/**
 * Point d'entrée public du module cloud (voir ../strava/index.js pour le même
 * principe déjà en place : l'UI et GPXAnalyzer.jsx ne doivent importer que
 * depuis ici, jamais directement client.js/auth.js/activities.js/files.js/
 * sync.js — pour garder la liberté de réorganiser l'intérieur du module sans
 * casser ses appelants).
 */

export { isCloudConfigured, getSupabaseClient } from "./client.js";

export { getCurrentUser, onAuthStateChange, signUp, signIn, signOut } from "./auth.js";

export {
  listCloudActivities,
  getCloudActivity,
  findCloudActivityByHash,
  deleteCloudActivity,
} from "./activities.js";

export { uploadActivityFile, downloadActivityFile, deleteActivityFile } from "./files.js";

export { uploadActivity } from "./sync.js";

export { computeFileHash, ACTIVITY_FILES_BUCKET } from "./types.js";

export * from "./errors.js";

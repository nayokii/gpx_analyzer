/**
 * Erreurs typées pour le module cloud (voir ../strava/errors.js pour le même
 * principe déjà en place dans ce projet) : chaque erreur distingue le
 * problème rencontré pour que l'UI affiche un message précis, SANS jamais
 * exposer un jeton/mot de passe/clé dans un message.
 */

export class CloudError extends Error {
  constructor(message, code) {
    super(message);
    this.name = "CloudError";
    this.code = code;
  }
}

/** VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY absents — voir .env.example. */
export class CloudNotConfiguredError extends CloudError {
  constructor() {
    super("Le cloud n'est pas configuré (VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY manquants). Voir .env.example.", "not_configured");
    this.name = "CloudNotConfiguredError";
  }
}

/** Action nécessitant une session (list/upload/delete) appelée sans utilisateur connecté. */
export class CloudNotAuthenticatedError extends CloudError {
  constructor() {
    super("Aucun compte cloud connecté.", "not_authenticated");
    this.name = "CloudNotAuthenticatedError";
  }
}

/** Erreur renvoyée par Supabase Auth (identifiants invalides, mot de passe trop court, email déjà utilisé...). */
export class CloudAuthError extends CloudError {
  constructor(message) {
    super(message || "Échec de l'authentification.", "auth_error");
    this.name = "CloudAuthError";
  }
}

/** Erreur renvoyée par une requête Postgres/PostgREST (hors doublon, voir CloudDuplicateActivityError). */
export class CloudApiError extends CloudError {
  constructor(message, details = null) {
    super(message || "Erreur lors de la communication avec le cloud.", "api_error");
    this.name = "CloudApiError";
    this.details = details;
  }
}

/** Erreur renvoyée par Supabase Storage (upload/download du fichier original). */
export class CloudStorageError extends CloudError {
  constructor(message) {
    super(message || "Erreur lors du transfert du fichier.", "storage_error");
    this.name = "CloudStorageError";
  }
}

/**
 * Pas vraiment une erreur d'échec : signale que le fichier proposé a déjà été
 * synchronisé (même empreinte). Portée comme une exception typée (plutôt
 * qu'un flag booléen) pour que l'appelant ne puisse pas l'ignorer par
 * inadvertance — voir sync.js.
 */
export class CloudDuplicateActivityError extends CloudError {
  constructor(existingActivity) {
    super("Cette sortie a déjà été synchronisée (fichier identique).", "duplicate_activity");
    this.name = "CloudDuplicateActivityError";
    this.existingActivity = existingActivity;
  }
}

/** Format de fichier source non pris en charge par la synchronisation cloud (voir consigne §6 : GPX/FIT uniquement). */
export class CloudUnsupportedSourceError extends CloudError {
  constructor(sourceType) {
    super(`Cette sortie (source : ${sourceType}) ne peut pas être synchronisée dans le cloud (seuls les fichiers GPX/FIT originaux le peuvent).`, "unsupported_source");
    this.name = "CloudUnsupportedSourceError";
    this.sourceType = sourceType;
  }
}

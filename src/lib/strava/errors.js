/**
 * Erreurs typées pour l'intégration Strava.
 *
 * Chaque erreur distingue le problème rencontré (connexion absente, refus
 * OAuth, callback invalide, jeton expiré, échec de rafraîchissement, API
 * indisponible, limite de requêtes atteinte, activité/flux inaccessible,
 * donnée malformée) pour que l'UI puisse afficher un message précis SANS
 * jamais exposer un token ou un secret (voir chaque message ci-dessous :
 * aucun ne doit jamais interpoler un access_token/refresh_token/client_secret).
 */

export class StravaError extends Error {
  constructor(message, code) {
    super(message);
    this.name = "StravaError";
    this.code = code;
  }
}

export class StravaNotConnectedError extends StravaError {
  constructor() {
    super("Aucun compte Strava connecté.", "not_connected");
    this.name = "StravaNotConnectedError";
  }
}

export class StravaAuthDeniedError extends StravaError {
  constructor(reason = null) {
    super("Autorisation Strava refusée.", "auth_denied");
    this.name = "StravaAuthDeniedError";
    this.reason = reason;
  }
}

export class StravaInvalidCallbackError extends StravaError {
  constructor(detail = null) {
    super("Réponse de callback Strava invalide.", "invalid_callback");
    this.name = "StravaInvalidCallbackError";
    this.detail = detail;
  }
}

export class StravaScopeError extends StravaError {
  constructor(grantedScope) {
    super(
      "Les autorisations accordées par Strava n'incluent pas la lecture des activités (activity:read). Reconnecte Strava en acceptant cette autorisation.",
      "insufficient_scope"
    );
    this.name = "StravaScopeError";
    this.grantedScope = grantedScope;
  }
}

export class StravaTokenExpiredError extends StravaError {
  constructor() {
    super("Le jeton d'accès Strava a expiré.", "token_expired");
    this.name = "StravaTokenExpiredError";
  }
}

export class StravaRefreshError extends StravaError {
  constructor(detail = null) {
    super("Impossible de renouveler la connexion Strava. Reconnecte ton compte.", "refresh_failed");
    this.name = "StravaRefreshError";
    this.detail = detail;
  }
}

export class StravaApiUnavailableError extends StravaError {
  constructor(status = null) {
    super("Le service Strava est indisponible pour le moment.", "api_unavailable");
    this.name = "StravaApiUnavailableError";
    this.status = status;
  }
}

export class StravaRateLimitError extends StravaError {
  constructor(retryAfterSeconds = null) {
    super("Limite de requêtes Strava atteinte. Réessaie plus tard.", "rate_limited");
    this.name = "StravaRateLimitError";
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

export class StravaActivityUnavailableError extends StravaError {
  constructor(activityId) {
    super(`Activité Strava ${activityId} inaccessible (supprimée, privée, ou non autorisée).`, "activity_unavailable");
    this.name = "StravaActivityUnavailableError";
    this.activityId = activityId;
  }
}

export class StravaMalformedDataError extends StravaError {
  constructor(detail = null) {
    super("Donnée Strava malformée reçue de l'API.", "malformed_data");
    this.name = "StravaMalformedDataError";
    this.detail = detail;
  }
}

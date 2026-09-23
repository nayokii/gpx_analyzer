/**
 * Seul module de tout le projet qui lit STRAVA_CLIENT_SECRET.
 *
 * Il tourne côté serveur (Netlify Functions), jamais dans le bundle Vite
 * livré au navigateur — `process.env` n'existe pas dans le code frontend, et
 * ce fichier n'est importé par aucun fichier sous src/. Voir
 * docs/STRAVA_INTEGRATION.md pour la justification de cette séparation.
 */

const TOKEN_URL = "https://www.strava.com/oauth/token";
const REVOKE_URL = "https://www.strava.com/oauth/revoke";

function requireEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Variable d'environnement serveur manquante : ${name}. Configure-la dans .env (dev) ou les variables d'environnement Netlify (prod) — voir .env.example.`);
  return value;
}

function toClientPayload(strava) {
  return {
    accessToken: strava.access_token,
    refreshToken: strava.refresh_token,
    expiresAt: strava.expires_at,
    scope: strava.scope || null,
    athlete: strava.athlete
      ? { id: strava.athlete.id, firstname: strava.athlete.firstname || null, lastname: strava.athlete.lastname || null }
      : null,
  };
}

/** Échange un code d'autorisation contre des jetons (grant_type=authorization_code). */
export async function exchangeCode(code) {
  const clientId = requireEnv("STRAVA_CLIENT_ID");
  const clientSecret = requireEnv("STRAVA_CLIENT_SECRET");

  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ client_id: clientId, client_secret: clientSecret, code, grant_type: "authorization_code" }),
  });
  if (!res.ok) {
    throw new Error(`Échec de l'échange du code Strava (HTTP ${res.status}).`);
  }
  const data = await res.json();
  return toClientPayload(data);
}

/** Rafraîchit un access_token (grant_type=refresh_token). Le refresh_token
 * renvoyé peut différer de celui envoyé (rotation) : toujours utiliser le
 * plus récent (voir docs). */
export async function refreshToken(refreshTokenValue) {
  const clientId = requireEnv("STRAVA_CLIENT_ID");
  const clientSecret = requireEnv("STRAVA_CLIENT_SECRET");

  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ client_id: clientId, client_secret: clientSecret, grant_type: "refresh_token", refresh_token: refreshTokenValue }),
  });
  if (!res.ok) {
    throw new Error(`Échec du rafraîchissement du jeton Strava (HTTP ${res.status}).`);
  }
  const data = await res.json();
  return toClientPayload(data);
}

/** Révoque un jeton (déconnexion complète côté Strava). Authentification
 * Basic client_id:client_secret, comme documenté par Strava pour cet
 * endpoint (contrairement à l'échange/rafraîchissement, qui les passent en
 * corps de requête). */
export async function revokeToken(accessToken) {
  const clientId = requireEnv("STRAVA_CLIENT_ID");
  const clientSecret = requireEnv("STRAVA_CLIENT_SECRET");
  const basic = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");

  const res = await fetch(REVOKE_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Basic ${basic}` },
    body: JSON.stringify({ token: accessToken }),
  });
  if (!res.ok) {
    throw new Error(`Échec de la révocation du jeton Strava (HTTP ${res.status}).`);
  }
}

/**
 * POST /.netlify/functions/strava-revoke   body: { accessToken }
 *
 * Révoque la connexion Strava (déconnexion complète côté Strava — l'app
 * disparaît des paramètres connectés de l'athlète). Basic Auth
 * client_id:client_secret gérée côté serveur uniquement (voir
 * _shared/stravaToken.js).
 */
import { revokeToken } from "./_shared/stravaToken.js";

export const handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: JSON.stringify({ error: "Méthode non autorisée." }) };
  }

  let accessToken;
  try {
    ({ accessToken } = JSON.parse(event.body || "{}"));
  } catch {
    return { statusCode: 400, body: JSON.stringify({ error: "Corps de requête invalide." }) };
  }
  if (!accessToken) {
    return { statusCode: 400, body: JSON.stringify({ error: "Paramètre 'accessToken' manquant." }) };
  }

  try {
    await revokeToken(accessToken);
    return { statusCode: 200, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ok: true }) };
  } catch (err) {
    return { statusCode: 502, body: JSON.stringify({ error: "Révocation du jeton Strava impossible." }) };
  }
};

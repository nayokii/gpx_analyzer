/**
 * POST /.netlify/functions/strava-refresh   body: { refreshToken }
 *
 * Rafraîchit un access_token Strava expiré (ou proche de l'expiration) via
 * son refresh_token. Le client_secret requis reste côté serveur (voir
 * _shared/stravaToken.js). Ne jamais consigner un jeton dans les logs.
 */
import { refreshToken as doRefresh } from "./_shared/stravaToken.js";

export const handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: JSON.stringify({ error: "Méthode non autorisée." }) };
  }

  let refreshToken;
  try {
    ({ refreshToken } = JSON.parse(event.body || "{}"));
  } catch {
    return { statusCode: 400, body: JSON.stringify({ error: "Corps de requête invalide." }) };
  }
  if (!refreshToken) {
    return { statusCode: 400, body: JSON.stringify({ error: "Paramètre 'refreshToken' manquant." }) };
  }

  try {
    const tokens = await doRefresh(refreshToken);
    return { statusCode: 200, headers: { "Content-Type": "application/json" }, body: JSON.stringify(tokens) };
  } catch (err) {
    return { statusCode: 502, body: JSON.stringify({ error: "Rafraîchissement du jeton Strava impossible." }) };
  }
};

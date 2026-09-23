/**
 * POST /.netlify/functions/strava-exchange   body: { code }
 *
 * Échange un code d'autorisation OAuth Strava contre des jetons. C'est la
 * SEULE façon dont le frontend obtient des jetons : le client_secret requis
 * pour cet appel (voir _shared/stravaToken.js) ne quitte jamais ce fichier
 * serveur. Ne jamais consigner `code`, ni les jetons renvoyés, dans les logs.
 */
import { exchangeCode } from "./_shared/stravaToken.js";

export const handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: JSON.stringify({ error: "Méthode non autorisée." }) };
  }

  let code;
  try {
    ({ code } = JSON.parse(event.body || "{}"));
  } catch {
    return { statusCode: 400, body: JSON.stringify({ error: "Corps de requête invalide." }) };
  }
  if (!code) {
    return { statusCode: 400, body: JSON.stringify({ error: "Paramètre 'code' manquant." }) };
  }

  try {
    const tokens = await exchangeCode(code);
    return { statusCode: 200, headers: { "Content-Type": "application/json" }, body: JSON.stringify(tokens) };
  } catch (err) {
    return { statusCode: 502, body: JSON.stringify({ error: "Échange du code Strava impossible." }) };
  }
};

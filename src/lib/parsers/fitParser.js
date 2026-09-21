/**
 * Parser FIT
 *
 * Décode un fichier FIT binaire (ArrayBuffer) via la bibliothèque officielle
 * Garmin (@garmin/fitsdk) et retourne les points dans le même format que le
 * parser GPX : { lat, lon, ele, time, hr, cad, power, temp }.
 *
 * En plus de ces champs "calculables" (mêmes noms que GPX pour que analysis.js
 * n'ait rien à connaître du format source), chaque point porte les valeurs
 * *mesurées* par le device quand le FIT les fournit : `distanceMeasured` (km)
 * et `speedMeasured` (km/h). Elles ne remplacent jamais les valeurs que notre
 * moteur recalcule (voir analysis.js) — les deux coexistent pour comparaison.
 *
 * Règle absolue (comme pour GPX) : un champ absent du fichier FIT reste
 * `null`, jamais déduit ou approximé ici.
 *
 * @garmin/fitsdk n'est jamais importé statiquement ici : il pèse plusieurs
 * centaines de Ko (Decoder + Encoder + profil complet) et ne doit donc être
 * chargé par le navigateur que si un fichier FIT est réellement importé,
 * jamais pour un import GPX. `isFITFile` (utilisée par la détection de
 * format, appelée sur CHAQUE fichier importé) réimplémente donc la
 * vérification de signature ".FIT" en JS pur, sans dépendre du SDK — c'est
 * exactement la vérification documentée par `Decoder.isFIT()` (octets 8-11
 * du header == ".FIT"), donc un comportement strictement identique. Seul
 * `parseFITArrayBuffer`, appelé uniquement une fois le format FIT confirmé,
 * charge le SDK via un `import()` dynamique.
 */

const SEMICIRCLE_TO_DEGREES = 180 / Math.pow(2, 31);
const FIT_SIGNATURE_OFFSET = 8;
const FIT_SIGNATURE = ".FIT";

/**
 * Vérifie la signature binaire FIT (octets 8-11 == ".FIT"), indépendamment de
 * l'extension du fichier. Ne charge pas @garmin/fitsdk (voir note en tête de
 * fichier) : c'est cette fonction qui permet à un import GPX de ne jamais
 * déclencher le chargement du SDK FIT.
 * @param {ArrayBuffer} arrayBuffer
 * @returns {boolean}
 */
export function isFITFile(arrayBuffer) {
  if (!arrayBuffer || arrayBuffer.byteLength < FIT_SIGNATURE_OFFSET + FIT_SIGNATURE.length) return false;
  const bytes = new Uint8Array(arrayBuffer, FIT_SIGNATURE_OFFSET, FIT_SIGNATURE.length);
  let signature = "";
  for (let i = 0; i < bytes.length; i++) signature += String.fromCharCode(bytes[i]);
  return signature === FIT_SIGNATURE;
}

/**
 * Convertit une vitesse en m/s (unité native du profil FIT) en km/h.
 * @param {number|null|undefined} ms
 * @returns {number|null}
 */
function msToKmh(ms) {
  return ms != null ? ms * 3.6 : null;
}

/**
 * Convertit une distance en mètres (unité native du profil FIT) en km.
 * @param {number|null|undefined} m
 * @returns {number|null}
 */
function mToKm(m) {
  return m != null ? m / 1000 : null;
}

/**
 * Parse un fichier FIT et extrait tous les points avec leurs données.
 *
 * @param {ArrayBuffer} arrayBuffer - Contenu binaire brut du fichier FIT
 * @returns {Promise<{
 *   name: string|null,
 *   points: Array,
 *   measured: {distanceKm: number|null, avgSpeedKmh: number|null, maxSpeedKmh: number|null}
 * }>} Asynchrone : charge @garmin/fitsdk à la volée (voir note en tête de fichier)
 * @throws {Error} Si le fichier n'est pas un FIT valide ou ne contient pas de points exploitables
 */
export async function parseFITArrayBuffer(arrayBuffer) {
  if (!isFITFile(arrayBuffer)) {
    throw new Error("Ce fichier n'est pas un FIT valide (signature .FIT absente du header).");
  }

  // Chargement différé : @garmin/fitsdk n'atterrit dans le bundle initial ni
  // dans le chemin d'import GPX, seulement ici, quand un FIT est confirmé.
  const { Decoder, Stream } = await import("@garmin/fitsdk");
  const stream = Stream.fromArrayBuffer(arrayBuffer);

  const decoder = new Decoder(stream);
  if (!decoder.checkIntegrity()) {
    throw new Error("Fichier FIT corrompu ou incomplet (échec du contrôle d'intégrité / CRC).");
  }

  const { messages, errors } = decoder.read();
  if (errors && errors.length > 0) {
    throw new Error("Erreur de décodage du fichier FIT : " + errors.map((e) => e.message || String(e)).join("; "));
  }

  const records = messages.recordMesgs || [];
  if (records.length === 0) {
    throw new Error("Aucun point (message record) trouvé dans ce fichier FIT.");
  }

  const points = records
    .map((r) => {
      if (r.positionLat == null || r.positionLong == null) return null;
      const lat = r.positionLat * SEMICIRCLE_TO_DEGREES;
      const lon = r.positionLong * SEMICIRCLE_TO_DEGREES;
      if (isNaN(lat) || isNaN(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;

      const speedMs = r.speed != null ? r.speed : (r.enhancedSpeed != null ? r.enhancedSpeed : null);
      const altitude = r.altitude != null ? r.altitude : (r.enhancedAltitude != null ? r.enhancedAltitude : null);

      return {
        lat,
        lon,
        ele: altitude != null ? altitude : null,
        time: r.timestamp ? new Date(r.timestamp) : null,
        hr: r.heartRate != null ? r.heartRate : null,
        cad: r.cadence != null ? r.cadence : null,
        power: r.power != null ? r.power : null,
        temp: r.temperature != null ? r.temperature : null,
        distanceMeasured: mToKm(r.distance != null ? r.distance : null),
        speedMeasured: msToKmh(speedMs),
      };
    })
    .filter((p) => p !== null);

  if (points.length < 2) {
    throw new Error("Ce fichier FIT ne contient pas assez de points GPS valides pour une analyse.");
  }

  const sport = (messages.sportMesgs || [])[0] || null;
  const name = sport && sport.name ? sport.name : null;

  const session = (messages.sessionMesgs || [])[0] || null;
  const sessionAvgSpeedMs = session ? (session.avgSpeed != null ? session.avgSpeed : session.enhancedAvgSpeed) : null;
  const sessionMaxSpeedMs = session ? (session.maxSpeed != null ? session.maxSpeed : session.enhancedMaxSpeed) : null;
  const measured = {
    distanceKm: session ? mToKm(session.totalDistance != null ? session.totalDistance : null) : null,
    avgSpeedKmh: msToKmh(sessionAvgSpeedMs != null ? sessionAvgSpeedMs : null),
    maxSpeedKmh: msToKmh(sessionMaxSpeedMs != null ? sessionMaxSpeedMs : null),
  };

  return { name, points, measured };
}

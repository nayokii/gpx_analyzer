/**
 * Parser GPX
 *
 * Extrait les données d'un fichier GPX et les retourne dans un format normalisé.
 * Gère les points de trace (trkpt), les extensions GPX standard, et les données
 * de capteurs (FC, cadence, puissance, température).
 */

/**
 * Parse un fichier GPX et extrait tous les points avec leurs données
 *
 * @param {string} xmlText - Contenu XML du fichier GPX
 * @returns {{name: string|null, points: Array}} Nom de l'activité et points GPS
 * @throws {Error} Si le fichier n'est pas un GPX valide ou ne contient pas de points
 */
export function parseGPXString(xmlText) {
  const parser = new DOMParser();
  const doc = parser.parseFromString(xmlText, "application/xml");

  // Vérifier les erreurs de parsing XML
  if (doc.querySelector("parsererror")) {
    throw new Error("Ce fichier n'est pas un GPX valide (erreur de lecture XML).");
  }

  // Extraire tous les points de trace
  const trkpts = Array.from(doc.getElementsByTagName("trkpt"));
  if (trkpts.length === 0) {
    throw new Error("Aucun point GPS (trkpt) trouvé dans ce fichier GPX.");
  }

  // Extraire le nom de l'activité (premier élément <name> trouvé)
  const nameEl = doc.getElementsByTagName("name")[0];
  const name = nameEl && nameEl.textContent.trim() ? nameEl.textContent.trim() : null;

  // Parser chaque point
  const points = trkpts
    .map((pt) => {
      const lat = parseFloat(pt.getAttribute("lat"));
      const lon = parseFloat(pt.getAttribute("lon"));

      // Initialiser toutes les données optionnelles à null
      let ele = null,
        time = null,
        hr = null,
        cad = null,
        power = null,
        temp = null;

      // Altitude (élément direct <ele>)
      const eleEl = pt.getElementsByTagName("ele")[0];
      if (eleEl && eleEl.textContent) {
        const v = parseFloat(eleEl.textContent);
        if (!isNaN(v)) ele = v;
      }

      // Horodatage (élément direct <time>)
      const timeEl = pt.getElementsByTagName("time")[0];
      if (timeEl && timeEl.textContent) {
        const t = new Date(timeEl.textContent);
        if (!isNaN(t.getTime())) time = t;
      }

      // Puissance (élément direct <power>, parfois présent en GPX 1.1)
      const directPower = Array.from(pt.children).find(
        (c) => ((c.localName || c.tagName).toLowerCase()) === "power"
      );
      if (directPower) {
        const v = parseFloat(directPower.textContent);
        if (!isNaN(v)) power = v;
      }

      // Extensions GPX (contiennent généralement FC, cadence, puissance, température)
      const extEl = pt.getElementsByTagName("extensions")[0];
      if (extEl) {
        const all = extEl.getElementsByTagName("*");
        for (let i = 0; i < all.length; i++) {
          const el = all[i];
          const ln = (el.localName || el.tagName.split(":").pop() || "").toLowerCase();
          const val = parseFloat(el.textContent);
          if (isNaN(val)) continue;

          // Mapper les noms d'éléments courants aux variables
          if ((ln === "hr" || ln === "heartrate") && hr === null) hr = val;
          else if ((ln === "cad" || ln === "cadence") && cad === null) cad = val;
          else if ((ln === "power" && power === null)) power = val;
          else if ((ln === "atemp" || ln === "temp" || ln === "temperature") && temp === null) temp = val;
        }
      }

      return { lat, lon, ele, time, hr, cad, power, temp };
    })
    // Filtrer les points invalides (coordonnées GPS hors limites)
    .filter((p) => !isNaN(p.lat) && !isNaN(p.lon) && Math.abs(p.lat) <= 90 && Math.abs(p.lon) <= 180);

  // Vérifier qu'il reste suffisamment de points valides
  if (points.length < 2) {
    throw new Error("Ce fichier GPX ne contient pas assez de points GPS valides pour une analyse.");
  }

  return { name, points };
}

/**
 * Vérifie si un fichier semble être un GPX valide (vérification rapide avant parsing complet)
 *
 * @param {string} content - Contenu du fichier
 * @returns {boolean}
 */
export function isGPXFile(content) {
  if (!content || typeof content !== 'string') return false;

  // Vérification simple : présence de balises GPX caractéristiques
  const lowerContent = content.toLowerCase();
  return (
    lowerContent.includes('<gpx') &&
    (lowerContent.includes('<trk') || lowerContent.includes('<trkpt'))
  );
}

/**
 * Extrait les métadonnées du GPX sans parser tous les points
 * Utile pour un aperçu rapide avant import complet
 *
 * @param {string} xmlText - Contenu XML du fichier GPX
 * @returns {{name: string|null, pointCount: number, hasTime: boolean}}
 */
export function extractGPXMetadata(xmlText) {
  const parser = new DOMParser();
  const doc = parser.parseFromString(xmlText, "application/xml");

  if (doc.querySelector("parsererror")) {
    return { name: null, pointCount: 0, hasTime: false };
  }

  const nameEl = doc.getElementsByTagName("name")[0];
  const name = nameEl && nameEl.textContent.trim() ? nameEl.textContent.trim() : null;

  const trkpts = doc.getElementsByTagName("trkpt");
  const pointCount = trkpts.length;

  // Vérifier si au moins un point a un horodatage
  let hasTime = false;
  if (trkpts.length > 0) {
    const firstPoint = trkpts[0];
    const timeEl = firstPoint.getElementsByTagName("time")[0];
    hasTime = !!(timeEl && timeEl.textContent);
  }

  return { name, pointCount, hasTime };
}

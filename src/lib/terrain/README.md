# Analyse du terrain (onglet Technique d'une sortie)

Dossier `src/lib/terrain/`, affiché par `src/components/TerrainView.jsx` (onglet « Technique » de l'Analyse).
**Distinct** de la dimension « Technique » du Profil (`lib/profile/dimensions/technical.js`), qui n'est pas modifiée.

## Source des données
OpenStreetMap, via l'API **Overpass** publique (`overpass-api.de`, repli `overpass.kumi.systems`) : sans clé, sans secret.
Les tuiles Leaflet n'ont aucun attribut de chemin : seule une vraie requête de données géographiques permet de classer.

## Confidentialité
- Jamais le fichier GPX/FIT, jamais le tracé : seules des **zones fixes de ~2 × 2 km** (`geo.js`) traversées par le tracé sont demandées (jusqu'à 3 rectangles par requête).
- Aucune requête sans **consentement explicite** (`preferences.js`, révocable). Sans consentement : cache local seul.
- Réponses gardées dans IndexedDB (30 jours), requêtes séquentielles espacées de ~1,2 s, délai max 30 s par requête,
  abandon au-delà de 40 zones.

## Résilience du service Overpass (jamais de tempête de requêtes)
Le service public est partagé et par moments saturé (504 « Dispatcher… server too busy », 429, 5xx ; l'instance de secours
`overpass.kumi.systems` peut répondre 500 sans en-têtes CORS, ce que le navigateur voit comme une simple erreur réseau).
- **Regroupement** : jusqu'à `CELLS_PER_REQUEST = 3` zones partagent UNE requête sous forme d'**union de rectangles** (un rectangle par zone,
  jamais une boîte englobante : la surface interrogée est exactement la somme des zones). Chaque zone est mise en cache séparément
  (`waysForCell`). Un tracé de 22 zones passe de 22 à 8 requêtes.
- **Un essai par serveur et par groupe** (serveur principal puis secours : 2 requêtes maximum) ; aucun nouvel essai sur un serveur déjà
  essayé, aucune pause de reprise. Un serveur en échec 2 fois de suite pendant l'exécution n'est plus sollicité (un succès remet le compteur à zéro).
  Tous les échecs (HTTP 400/403/429/5xx, réseau, délai dépassé, réponse invalide) sont traités de la même façon : zone `error` (ou `stale` si une copie périmée existe).
- **HTTP 429** : arrêt IMMÉDIAT, aucun nouveau groupe pendant l'exécution (`rateLimited`, `retryAfterMs` si `Retry-After` est lisible).
- **Disjoncteur** `MAX_FAILED_CELLS = 2` : après 2 groupes consécutifs en échec, les zones restantes sont `deferred` et `unavailable: true`.
- **Plafond absolu** `MAX_REQUESTS_PER_RUN = 6` requêtes par exécution de `loadCells` (jusqu'à 18 zones en un passage). `capped: true` si le plafond laisse des zones alors que le service répond.
- **Délai avant toute nouvelle requête** (appliqué par `TerrainView`, conservé dans le navigateur via `preferences.js`, donc non contournable en changeant d'onglet ou en rechargeant) :
  **≥ 30 s après un 429** (davantage si `Retry-After` l'annonce, plafonné à 5 min), 15 s après une autre panne. Aucune requête automatique : « Réessayer » / « Charger… » programme la requête à l'échéance (compte à rebours),
  le consentement étant revérifié au départ. Seules les zones en échec ou différées sont redemandées (cache frais jamais redemandé).

## Méthode
1. `matching.js` : le tracé est découpé en sous-segments ≤ 25 m, chacun rattaché au chemin le plus proche (≤ 20 m), sinon « non classifié ».
   Chaque mètre n'est compté qu'une fois (pas de double comptage des chemins superposés).
2. `classify.js` : `road` / `track` / `trail`. Surface revêtue → route ; piste non revêtue → piste ; `path`/`bridleway` non revêtus → sentier ; `footway` seulement si surface non revêtue explicite (trottoirs, passages piétons, escaliers ignorés) ;
   voie de circulation à surface non revêtue → piste. La forêt n'intervient pas.
3. `profile.js` : distances et % (sur la distance totale, non classifié inclus), couverture, type :
   couverture < 50 % → Indéterminé ; route ≥ 80 % du classifié → Route ; route 25-80 % → Mixte ; sinon sentiers ≥ 35 % → VTT sentiers, sinon VTT chemins/pistes.
4. `difficulty.js` : note /100 = terrain (0-75, tags OSM explicites : `mtb:scale`, `sac_scale`, `smoothness`, `trail_visibility`, `tracktype`, `surface`)
   + pente (0-15, part du hors-route à ≥ 10 %) + virages (0-10, virages ≥ 45 °/km hors route).
   Niveaux : < 30 Facile, 30-54 Modéré, ≥ 55 Difficile. « Données insuffisantes » si couverture < 50 % ; « Non applicable » si sortie routière / hors-route < 1 km ou < 20 %.
   Confiance : couverture + part des chemins hors route portant des tags de difficulté (`surface` seul n'en est pas un) (+ altitude disponible, sinon plafonnée à « moyenne » et signalée).

## Limites
Racines, pierres, boue, adhérence et état du jour ne sont pas détectables sur une carte. Les polygones forêt (`landuse=forest`, `natural=wood`) ne sont
pas téléchargés : ils ne changeraient pas le type de voie. La qualité dépend de la complétude d'OpenStreetMap (tags techniques souvent absents).
Les seuils sont des constantes documentées, pas des valeurs étalonnées sur des données terrain.

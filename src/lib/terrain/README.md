# Analyse du terrain (onglet Technique d'une sortie)

Dossier `src/lib/terrain/`, affiché par `src/components/TerrainView.jsx` (onglet « Technique » de l'Analyse).
**Distinct** de la dimension « Technique » du Profil (`lib/profile/dimensions/technical.js`), qui n'est pas modifiée.

## Sources des données (IGN principal, OpenStreetMap en complément)
- **IGN BD TOPO®** (couche `BDTOPO_V3:troncon_de_route`, service WFS public de la Géoplateforme, sans clé, CORS ouvert) : source PRINCIPALE en
  France métropolitaine et dans les DOM (`coverage.js`, filtre grossier par boîtes ; la couverture réelle vient de la réponse : une zone sans aucun
  tronçon est « sans données IGN », jamais présentée comme couverte). Adaptateur : `ign.js` (chargement, cache `ign:<zone>`, concurrence 2, départs
  espacés de 250 ms, pagination, arrêt sur 429/pannes) et `ignConvert.js` (conversion des champs). Limite publiée (CGU cartes.gouv.fr, 15/10/2024) : 30 req/s/IP.
- **OpenStreetMap** via **Overpass** : source principale HORS territoire IGN, secours quand l'IGN n'a rien ou est en panne, et COMPLÉMENT FACULTATIF
  (surface, technicité) sur les zones IGN (`merge.js`). Le complément se désactive dans la boîte de consentement ; son échec n'arrête jamais l'analyse IGN.
- **Ce que la BD TOPO contient (vérifié par sondes réelles)** : `nature` (Route à 1/2 chaussée(s), Rond-point, Route empierrée, Chemin, Sentier, Escalier…),
  `urbain`, `etat_de_l_objet`, `fictif`, `cleabs`, `date_modification`, géométrie [lon, lat, altitude]. Elle ne contient NI revêtement, NI praticabilité, NI
  difficulté VTT : `surface`, `tracktype`, `smoothness`, `mtb:scale`, `sac_scale` et `trail_visibility` ne sont JAMAIS fabriqués à partir de l'IGN ; ils ne
  peuvent venir que d'OpenStreetMap.
- **Correspondance nature → `highway`** (`ignConvert.js`) : routes → `road` ; Chemin → `track` ; Sentier → `path` ; Piste cyclable → `cycleway` ; Escalier → `steps`
  (ignoré). Un tronçon garde sa valeur d'origine dans `ign:nature`. « Route empierrée » est classée piste d'après cette seule valeur (une surface OSM explicite
  l'emporte). Un « Sentier » en zone urbaine (`urbain = true`) est un cheminement piéton → `footway`, non classé. Toute nature inconnue est écartée et comptée.
- **Fusion** (`merge.js`) : un chemin OSM dont ≥ 60 % des points sont à ≤ 15 m d'un tronçon IGN est la MÊME voie : il l'enrichit (tags de surface/technicité
  seulement, sur une copie) et n'est pas ajouté ; sinon il est conservé (`src: "osm"`). Aucun double comptage, aucun cache modifié.
- **Provenance** (`provenance.js`) : sources des chemins rattachés, couverture, types de voies (dont la part issue de « Route empierrée »), part du hors-route
  portant de vrais tags techniques, confiance de l'estimation — toujours séparées de la difficulté, qui reste une ESTIMATION.

## Confidentialité
- Jamais le fichier GPX/FIT, jamais le tracé : seules des **zones fixes de ~2 × 2 km** (`geo.js`) traversées par le tracé sont demandées (4 bornes dans l'URL
  IGN ; jusqu'à 3 rectangles par requête Overpass). Aucune heure, fréquence cardiaque, puissance ni identité. Chaque serveur voit l'adresse IP.
- Aucune requête sans **consentement explicite** (`preferences.js`, clé `gpx-terrain-map-consent-v2`, révocable) couvrant l'IGN ET OpenStreetMap. L'ancien
  consentement OpenStreetMap seul n'est pas repris (nouveau destinataire). Sans consentement : cache local seul.
- Réponses gardées dans IndexedDB (IGN 90 jours, OpenStreetMap 30 jours). Attribution affichée : « Source : IGN — BD TOPO® (Licence Ouverte Etalab 2.0) » + date de
  dernière modification des tronçons, et © contributeurs OpenStreetMap (ODbL).

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

# Analyse du terrain (onglet Technique d'une sortie)

Dossier `src/lib/terrain/`, affiché par `src/components/TerrainView.jsx` (onglet « Technique » de l'Analyse).
**Distinct** de la dimension « Technique » du Profil (`lib/profile/dimensions/technical.js`), qui n'est pas modifiée.

## Source des données
OpenStreetMap, via l'API **Overpass** publique (`overpass-api.de`, repli `overpass.kumi.systems`) : sans clé, sans secret.
Les tuiles Leaflet n'ont aucun attribut de chemin : seule une vraie requête de données géographiques permet de classer.

## Confidentialité
- Jamais le fichier GPX/FIT, jamais le tracé : seules des **zones fixes de ~2 × 2 km** (`geo.js`) traversées par le tracé sont demandées.
- Aucune requête sans **consentement explicite** (`preferences.js`, révocable). Sans consentement : cache local seul.
- Réponses gardées dans IndexedDB (30 jours), requêtes séquentielles espacées de ~1,2 s, délai max 30 s par requête,
  abandon au-delà de 40 zones.

## Résilience du service Overpass (jamais de tempête de requêtes)
- **Un essai par serveur et par zone** (serveur principal puis serveur de secours : 2 requêtes maximum par zone) ; aucun nouvel
  essai sur un serveur déjà essayé, aucune pause de reprise, `Retry-After` n'est pas attendu. Tous les échecs (HTTP 400/403/429/5xx,
  réseau, délai dépassé, réponse invalide) sont traités de la même façon : la zone passe en `error` (ou `stale` si une copie périmée existe).
- **Disjoncteur** `MAX_FAILED_CELLS = 2` : après 2 zones consécutives en échec, les zones restantes sont `deferred`
  (comptées parmi les zones manquantes, `cellCounts.missing`/`deferred`) et `loadCells` renvoie `unavailable: true`.
  Un succès remet le compteur à zéro : un échec isolé n'interrompt rien.
- **Plafond absolu** `MAX_REQUESTS_PER_RUN = 6` requêtes réseau par exécution de `loadCells` (compteur partagé par toutes les zones
  et les deux serveurs). Si le plafond laisse des zones sans que le service ait échoué : `capped: true` (pas `unavailable`).
- **Relance** : uniquement manuelle (bouton « Réessayer » de `TerrainView`, délai de 15 s depuis la dernière tentative en échec,
  consentement revérifié). Une relance est une nouvelle exécution : seules les zones en échec ou différées sont redemandées
  (les zones en cache frais ne le sont jamais).

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

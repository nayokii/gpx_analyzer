# Performance — Phase 9E

Ce document consigne l'audit de performance qui a motivé les changements de
la Phase 9E, pour que les commentaires `voir docs/PERFORMANCE.md` dans le
code aient une trace complète. Mesures faites avec `performance.now()`, en
Node, sur les données réelles du dossier local de l'utilisateur (6 activités :
5 GPX + 1 FIT, ~13.8 MB de JSON au total, ~41 000 points échantillonnés).

## Cause du freeze

`src/lib/profile/activitySignals.js` appelle `computeAnalysis()` (le même
moteur d'analyse qu'à l'import) pour CHAQUE activité, à CHAQUE fois que
`computeCyclistProfile()` est appelé — et `computeCyclistProfile()` est
appelé indépendamment par `HomeView.jsx`, `ProfileView.jsx`,
`AlterEgoView.jsx` et `ArchetypeView.jsx`, à chaque montage (donc à chaque
changement d'onglet, puisque ce sont des composants démontés/remontés).

À l'intérieur de `computeAnalysis()`, `computePowerData()` appelait
`computeBestPowerEfforts()` (`src/lib/power.js`) pour 8 durées (5 s à
3600 s). L'implémentation d'origine recalculait la fenêtre glissante depuis
zéro (`series.slice(i, j)` + `filter` + `map`) à CHAQUE position `i`, avec
`j` repartant de `i` à chaque itération — coût proche de O(n × durée) par
durée demandée, dominé par les durées longues (600–3600 s).

## Mesure : le calcul le plus coûteux

Sur l'activité réelle la plus longue (« Roc Alizée 2026 », 15 382 points,
~4h17) :

| Fonction | Avant | Après |
|---|---|---|
| `computeBestPowerEfforts` (8 durées, 5–3600 s) | **12 441 ms** | **38 ms** (≈330×) |
| `computeAnalysis` (une activité) | 14 556 ms | ~200 ms (mesure indirecte) |

## Mesure : bout en bout sur les 6 activités réelles

| Étape | Avant | Après (algo seul, sans cache) | Après (+ cache dérivé) |
|---|---|---|---|
| `deriveAllActivitySignals` (6 activités) | 19 158 ms | 467 ms | — (identique, pas mis en cache directement) |
| `computeCyclistProfile` | 19 403 ms | 341 ms | ~0 ms (2ᵉ+ appel, même jeu d'activités) |
| `buildProfileTimeline` (2 buckets) | 23 295 ms | 414 ms | ~0 ms (2ᵉ+ appel) |
| `computeProgression` | 18 090 ms | 338 ms | ~0 ms (2ᵉ+ appel) |
| `buildArchetypeTimeline` (2 buckets, recalculait sa propre timeline) | 29 399 ms | 426 ms | ~0 ms (réutilise `getCachedProfileTimeline`) |
| **Navigation simulée Profile → Alter Ego → Archétype (1 aller simple)** | **126 899 ms** | **2 577 ms** | **quelques ms** au-delà du 1er montage |

(Lecture + `JSON.parse` des 6 fichiers d'activité : ~184 ms pour 1 lecture,
~548 ms pour 3 lectures indépendantes sans cache — partagé une seule fois
avec le cache d'activités, voir `src/lib/storage/activityCache.js`.)

## Recalculs inutiles trouvés

1. **`computeBestPowerEfforts`** : algorithme O(n × durée) au lieu de O(n) —
   voir « cause du freeze » ci-dessus. Corrigé par une fenêtre glissante à
   deux pointeurs (voir `src/lib/power.js`), résultat strictement identique
   (voir `power.test.js`, comparaison directe contre l'ancienne implémentation).
2. **Trois vues indépendantes rechargent les mêmes fichiers** :
   `ProfileView.jsx`, `AlterEgoView.jsx`, `ArchetypeView.jsx` (et
   `HomeView.jsx`) appellent chacune `loadActivityDetail()` pour TOUTES les
   activités de l'historique, à chaque montage — sans jamais réutiliser le
   résultat d'une autre vue. Corrigé par `src/lib/storage/activityCache.js`
   (cache par id, par dossier).
3. **Trois vues indépendantes recalculent le même profil/la même
   progression/le même matching** : `computeCyclistProfile`,
   `computeProgression`, `matchArchetypes`, `matchReferenceRiders` sont des
   fonctions PURES d'un même historique, mais recalculées à chaque montage de
   chaque vue. Corrigé par `src/lib/derivedCache.js` (mémoïsation par
   signature d'activités, ou par référence de `profile` pour les fonctions
   qui en dépendent).
4. **`buildArchetypeTimeline` recalculait sa propre `buildProfileTimeline`**,
   indépendamment de celle déjà calculée par `ProfileView.jsx` sur le même
   historique. Corrigé : `getCachedArchetypeTimeline()` réutilise
   `getCachedProfileTimeline()`.

## Ce qui n'a PAS été changé

- Aucune formule de `src/lib/profile/`, `src/lib/progression/`, ni
  `src/lib/archetypes/matching.js` (hors l'ajout du champ `reason`, purement
  additif, voir Phase 9E problème 1) — mêmes scores, mêmes confidences, même
  XP, mêmes achievements, même matching (voir tests d'équivalence dans
  `derivedCache.test.js`, `power.test.js`).
- Pas de Web Worker introduit : l'algorithme O(n) suffit à ramener le calcul
  le plus lourd sous la seconde sur les données réelles actuelles ; à
  reconsidérer seulement si un historique bien plus large redevenait lourd
  malgré le cache.
- Pas de limite de concurrence ajoutée sur le chargement des activités
  (`Promise.allSettled`) : sur les données réelles actuelles (6 activités),
  ce n'est pas le goulot — voir mesure ci-dessus (lecture+parse : quelques
  centaines de ms, négligeable face aux ~127 s d'origine). À réévaluer si un
  historique de plusieurs centaines d'activités montre un problème mesuré
  (mémoire ou nombre de handles fichier), plutôt que d'introduire une limite
  arbitraire non justifiée par une mesure.

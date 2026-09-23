# Tour Simulator — moteur (Phase 10A)

## Objectif

Répond à UNE question, de façon ludique et honnête :

> À partir de ce que mon profil cycliste documente actuellement, comment mon
> style semble-t-il s'accorder avec différents types d'étapes d'un Grand Tour ?

Ce n'est **jamais** une prédiction de performance réelle. Aucune vitesse,
aucun temps, aucun classement, aucun watt, aucune FTP, aucun VO2max n'est
calculé ou inventé ici. Le moteur compare la FORME du profil (quelles
dimensions dominent) à l'importance que chaque type de terrain accorde à ces
mêmes dimensions — exactement le même principe que
`src/lib/archetypes/matching.js` applique déjà pour comparer un profil à un
archétype ou à un coureur de référence, transposé à un type d'étape.

## Ce que ce module N'EST PAS

- Pas un calcul de performance réelle (« tu ferais tel temps »).
- Pas une comparaison de niveau (« tu es aussi fort que X »).
- Pas un modèle physiologique (la fatigue simulée n'est PAS une fatigue
  réelle — voir `fatigue.js`).
- Pas un second moteur de profil/scoring : il **consomme**
  `computeCyclistProfile()` (Phase 6A) et **réutilise**
  `archetypes/archetypeProfile.js: matchingWeight()` (Phase 9D) et
  `archetypes/matching.js: matchArchetypes()` (Phase 8/9D) tels quels.

## Chaîne

```
CyclistProfile (déjà calculé, jamais recalculé ici)
      +
Stage[] (données pures, voir stages.js — aucune dépendance externe)
      ↓ computeStageAffinity() par étape
affinité de style (0-100) + confiance + facteurs clés
      ↓ fatigue.js (mécanisme de jeu)
score ajusté par la fatigue simulée + "forme du jour" (seedée)
      ↓ results.js
résultat d'étape (catégorie, performanceBand)
      ↓ agrégation sur tout le Tour
résultat global (affinités par type de terrain, régularité, gestion de la
fatigue simulée, tendance de style réutilisée depuis archetypes/)
```

## Modèle d'étape (`stages.js`, `stageTypes.js`)

Une `Stage` a 6 caractéristiques normalisées **0-1**
(`endurance`/`climbing`/`punch`/`sprint`/`timeTrial`/`technical` — exactement
les 6 dimensions déjà utilisées par `archetypes/archetypes.js:
ARCHETYPE_DIMENSIONS`, `consistency` en est absente pour la même raison :
c'est une fréquence de pratique, pas un trait de style de course/terrain) et
une `difficulty` 0-1 utilisée par le modèle de fatigue.

6 types génériques sont documentés dans `stageTypes.js`
(`flat`/`hilly`/`mountain`/`highMountain`/`timeTrial`/`mixed`), chacun avec
un raisonnement qualitatif écrit en commentaire — **aucune donnée
professionnelle réelle**, un raisonnement documenté comme celui déjà utilisé
pour les archétypes de style.

`createGenericTour()` fournit un petit Tour fictif de 6 étapes (voir
consigne §13) pour les tests et la démonstration — **pas** le tracé d'un
Grand Tour réel. Un parcours réel pourra être injecté plus tard : il suffit
qu'il produise des objets `Stage` valides (voir `isValidStage()`).

## Affinité (`stageAffinity.js`)

```
affinité = Σ(valeur_dimension × importance_étape × matchingWeight(confidence))
           ──────────────────────────────────────────────────────────────────
           Σ(importance_étape × matchingWeight(confidence))
```

`matchingWeight()` est importée telle quelle depuis
`archetypes/archetypeProfile.js` (transformation `confidence²`, Phase 9D) :
une dimension peu documentée pèse beaucoup moins qu'une dimension bien
documentée, sans qu'on redérive ce problème déjà résolu ailleurs dans le
projet. Une dimension à `value: null` a un poids de 0 par construction —
jamais traitée comme 0, jamais comptée dans la moyenne.

Le résultat expose, par dimension : `value`, `confidence`,
`confidenceLabel`, `importance` (poids du type d'étape), `weight` (poids
final utilisé), `contribution` (part relative 0-1 du poids total — pour
expliquer "pourquoi ce score"). `keyFactors` liste les 3 dimensions dont la
contribution est la plus forte. `missingDimensions` liste les dimensions que
CETTE étape valorise (`importance > 0`) mais que le profil ne documente pas
encore.

### Catégories d'affinité

| Seuil (score 0-100) | Catégorie |
|---|---|
| ≥ 75 | très favorable |
| ≥ 60 | favorable |
| ≥ 40 | neutre |
| < 40 | moins favorable |
| `score === null` | données insuffisantes |

Jamais un classement absolu ("meilleur/pire") — uniquement des catégories
descriptives, comme `archetypes/matching.js: similarityLabel()`.

## Fatigue simulée (`fatigue.js`)

Un mécanisme de JEU, pas un modèle physiologique. `computeStageFatigue(stage,
previousState)` combine :
- la fatigue de la veille, en partie conservée (`FATIGUE_CARRYOVER`) ;
- la difficulté de l'étape du jour (`Stage.difficulty`) ;
- un petit bonus si plusieurs étapes "difficiles" (`difficulty >= 0.6`) se
  sont enchaînées consécutivement (plafonné à 4 jours).

`applyRecovery(previousState)` retire une fraction de la fatigue entre deux
étapes. Le résultat (0-1) réduit le score d'affinité de l'étape suivante
d'au plus 25 % (`FATIGUE_MAX_PENALTY`) — la fatigue nuance le résultat,
elle ne l'écrase jamais. Toutes les constantes sont documentées dans le
fichier, aucune n'est un nombre magique caché.

## Seed et "forme du jour"

`simulateTour({profile, stages, seed})` exige un `seed` (nombre ou chaîne).
La seule source de variation d'un run à l'autre est une petite oscillation
"forme du jour" (± 6 points max sur le score, générée par un PRNG seedé
`mulberry32`, domaine public, aucune dépendance ajoutée) — un mécanisme de
jeu assumé, jamais appliqué à une étape sans affinité calculable. Le même
`seed` + le même profil + le même Tour produisent **toujours** exactement le
même résultat (voir `simulation.test.js`).

## Résultat

Par étape (voir `results.js: buildStageResult`) : `affinity` (score de style
brut, indépendant de la fatigue de cette simulation), `category`,
`adjustedScore` (après fatigue + forme du jour), `performanceBand`
(`struggling`/`below_average`/`neutral`/`strong`/`very_strong`/
`insufficient_data` — des catégories de simulation, jamais présentées comme
une performance réelle), `fatigueBefore`/`fatigueAfter`, `keyFactors`,
`missingDimensions`.

Global (voir `results.js: buildOverallResult`) : affinités moyennes par type
de terrain (montagne, plat, vallonné, CLM — sur les scores BRUTS, pas
ajustés par la fatigue de ce run précis), `consistency` (régularité des
scores ajustés sur le Tour, dérivée de leur écart-type réel — jamais une
donnée externe), `fatigueManagement` (dérivé des états de fatigue simulée
déjà calculés), `documentationGaps` (dimensions/nombre d'étapes concernées),
et `profileArchetype` — **réutilisation directe** de
`archetypes/matching.js: matchArchetypes(profile)`, jamais un second système
de tendance de style. Délibérément **aucun classement/position** dans un
peloton fictif (voir consigne §10).

## Données insuffisantes

Le moteur fonctionne avec un profil incomplet ou totalement vide : chaque
dimension manquante est simplement exclue du calcul de poids (jamais
transformée en 0), et `missingDimensions`/`documentationGaps` identifient
précisément lesquelles, pour quelles étapes. Un profil sans aucune dimension
exploitable produit des étapes à `score: null`, `category: "données
insuffisantes"`, sans jamais lancer d'exception.

## Performance

Le moteur ne prend en entrée que `CyclistProfile` (déjà calculé) et
`Stage[]` (données pures 0-1) — jamais une `Activity`, jamais `samples`,
jamais un appel à `computeCyclistProfile()`/`computeAnalysis()`. Coût :
`O(étapes × 6 dimensions)`, pas `O(étapes × échantillons GPS)`.

## Ajouter un nouveau type d'étape

Ajouter une entrée dans `STAGE_TYPES` (`stageTypes.js`) avec ses 6
caractéristiques 0-1 et un `fatigueFactor` 0-1, en documentant le
raisonnement qualitatif en commentaire (voir les 6 types existants). Aucun
autre fichier n'a besoin de connaître la liste des types autrement qu'au
travers de `getStageTypeProfile()`/`STAGE_TYPE_IDS`.

## Fournir un autre parcours

Construire un tableau de `Stage` (voir `createStage()` pour partir d'un type
connu, ou construire l'objet directement s'il respecte la forme validée par
`isValidStage()`) et le passer à `simulateTour({profile, stages, seed})`.
Le moteur ne connaît et ne dépend d'aucune source de données de parcours
particulière (pas de scraping, pas d'API externe, pas de fichier GPX de
parcours réel dans cette phase).

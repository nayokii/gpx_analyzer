# Moteur de profil cycliste (Phase 6A)

Ce module calcule un **profil cycliste multidimensionnel** à partir de
l'historique réel des activités (`Activity[]`, voir `../types.js`). Il ne
construit ni alter ego, ni système de défis/XP, ni UI — uniquement le moteur
sous-jacent sur lequel ces fonctionnalités s'appuieront plus tard (voir
"Compatibilité future" en bas de page).

## Principe général

```
Activity[] (déjà chargées, jamais reparsées)
      ↓ activitySignals.js
signaux par activité (montées, efforts, meilleurs efforts — réutilise
analysis.js / analytics/* existants)
      ↓ normalization.js + confidence.js
dimensions (endurance, grimpe, punch, sprint, CLM, technique, régularité)
      ↓
profil cycliste structuré, sérialisable (profile.js)
```

Point d'entrée : `computeCyclistProfile(activities, options)`. Fonctionne
avec `[]`, 1 activité, ou un historique complet, sans jamais lancer
d'exception ni fabriquer de donnée absente.

## Règle n°1 : pas de score arbitraire

Aucune dimension n'utilise de coefficient inventé du type "D+ élevé = +20
grimpe". Chaque valeur provient d'un signal réellement mesuré/calculé,
normalisé par une méthode documentée (voir `normalization.js`), avec une
confiance qui reflète honnêtement la quantité et la qualité des données
disponibles.

## Que signifie le score 0-100 ?

**Ce n'est jamais un pourcentage de performance humaine absolue, ni une
comparaison à un niveau professionnel.** C'est un indice interne produit par
l'une de ces méthodes (voir `normalization.js`) :

- **Percentile propre** : position de la valeur dans la distribution
  historique DE L'UTILISATEUR LUI-MÊME. Fiable seulement avec assez de
  points (le poids de confiance vers cette méthode croît de 0 à 1 entre 1 et
  15 sorties contributrices — seuil documenté et calibré, pas un coefficient
  de score).
- **Échelle de démarrage ("cold start")** : place une valeur brute sur une
  courbe bornée et saturante, calibrée sur une plage de pratique **amateur
  générique et documentée par dimension** (jamais un référentiel
  professionnel). Utilisée seule tant que l'historique est trop court pour
  un percentile significatif.
- **Mélange** : les deux méthodes ci-dessus, combinées avec un poids qui
  glisse progressivement de l'une vers l'autre.

La régularité (consistency) fait exception : ses signaux sont déjà des
ratios [0,1] (semaines actives / semaines couvertes...) et n'ont donc pas
besoin de ce pipeline.

## Dimensions

| Dimension | Mesure | Ne mesure PAS | Signal principal |
|---|---|---|---|
| `endurance` | Position du "temps en mouvement long typique" (80e percentile de ses propres sorties) | VO2max, seuil physiologique | Temps en mouvement / durée |
| `climbing` | VAM médian (m/h montés) — rythme de montée | "A fait du D+" (exposition, alimente seulement la confiance/le contexte) | VAM par montée détectée |
| `punch` | Fréquence d'efforts courts/intenses (1-5 min) par heure de sortie | Une mesure physiologique précise sans capteur | Puissance si dispo, sinon vitesse (`dataQuality` l'indique) |
| `sprint` | Pic de puissance ~5 s | Rien sans capteur — `insufficient_data` explicite si pas de puissance MESURÉE | Puissance mesurée uniquement |
| `timeTrial` | Vitesse soutenue sur le plus long "meilleur effort" (k20/k10/k5/k1) | Une capacité physiologique absolue | Vitesse (puissance mesurée ajoutée en preuve contextuelle) |
| `technical` | Irrégularité du terrain (écart-type de pente) sur sorties `mtb`/`gravel` | La maîtrise/le pilotage | Écart-type de pente, repli sur variabilité de vitesse |
| `consistency` | Fréquence et continuité de la pratique (semaines actives, régularité du volume) | Un trait de caractère (jamais "discipline"/"motivation") | Dates des sorties |

## Mesuré vs estimé

Chaque preuve individuelle porte une `dataQuality` (`measured` / `estimated`
/ `speed` / `mixed`), dérivée de `Activity.flags.powerEstimated` — jamais
redérivée ni mélangée silencieusement (voir `activitySignals.js`). La
confiance d'une dimension est directement dégradée quand ses preuves
reposent sur de l'estimé plutôt que du mesuré (voir `confidence.js`,
`DATA_QUALITY_WEIGHTS`). Le sprint refuse catégoriquement toute puissance
estimée : sans capteur réel, `insufficient_data`.

## Cold start

Avec une seule vraie sortie, la plupart des dimensions produisent
`insufficient_data` (grimpe sans montée détectée, sprint sans puissance
mesurée, technique sans sortie mtb/gravel, régularité qui exige au moins 2
sorties datées). Celles qui PEUVENT produire une valeur avec un seul point
(endurance, grimpe si une montée existe, contre-la-montre si un meilleur
effort existe) le font avec une confiance toujours basse (`< 0.35`,
`confidenceLabel: "low"`) — jamais un score précis présenté comme fiable.
Voir `profileIntegration.test.js` pour la vérification sur le vrai fichier
FIT du projet.

## Confiance

`confidence.js` combine deux composantes multipliées :

1. **`sampleWeight`** : nombre d'activités/preuves contributrices, sur une
   courbe saturante (chaque preuve compte de moins en moins).
2. **`dataQualityWeight`** : mesuré (1.0) > mixte (0.75) > estimé (0.6) >
   vitesse seule (0.45).

`confidenceLabel` traduit la confiance numérique en
`insufficient_data`/`low`/`medium`/`high` pour l'affichage futur.

## Evidence

Chaque dimension conserve jusqu'à 10 preuves individuelles
(`{activityId, metric, value, dataQuality, reason}`, voir `evidence.js`),
pour qu'une future UI puisse répondre "pourquoi ce score ?" sans deviner la
structure interne.

## Profil dans le temps

`buildProfileTimeline(activities, options)` calcule le profil à plusieurs
points dans le temps (par mois par défaut), CUMULATIF par défaut (le profil
au point N utilise toute l'activité jusqu'à N inclus). Recalcule un profil
complet par bucket — acceptable au volume actuel, à optimiser en Phase 6B
(calcul incrémental) si le nombre de sorties grandit significativement.

## Compatibilité future (non construite dans cette phase)

Le profil est conçu pour être consommé, sans réécriture du moteur, par :
- l'**alter ego** (représentation visuelle/narrative du profil) ;
- l'**XP/évolution** (delta entre deux points de `buildProfileTimeline`) ;
- les **défis** (ciblage sur une dimension à confiance encore faible) ;
- le **matching à des archétypes/profils pros** (comparaison vectorielle des
  `dimensions.*.value` — le profil ne contient aucun profil-type ni
  référence professionnelle, cette phase ne fait qu'exposer des dimensions
  stables et comparables).

## Limites connues

- Les dimensions qui dépendent de montées/efforts détectés (`climbing`,
  `punch`, `sprint`, `timeTrial`) ont besoin d'`Activity.samples` — un
  résumé léger d'index (`index.json`, voir `../storage/activityStore.js`)
  ne les alimente pas ; l'appelant doit recharger les activités complètes
  (`loadActivityDetail`) pour un profil pleinement informé.
- `buildProfileTimeline` recalcule tout à chaque bucket (pas de calcul
  incrémental) — voir "Profil dans le temps" ci-dessus.
- Le fuseau horaire de `consistency` hérite de la même limite documentée
  dans `../history/dateUtils.js` (regroupement calendaire en fuseau LOCAL de
  l'environnement d'exécution).

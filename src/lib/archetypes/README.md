# Archétypes cyclistes & coureurs de référence (Phase 8)

Ce module répond à deux questions, en lecture seule au-dessus du profil 6A :
1. **Quel style de coureur correspond à la FORME de mon profil ?** (archétypes théoriques)
2. **Quels coureurs professionnels ont une structure de profil similaire ?** (base de référence locale)

```
Activity[] (déjà chargées)
      ↓ computeCyclistProfile() — Phase 6A, jamais recalculé différemment
Profil (7 dimensions, certaines éventuellement null)
      ↓ archetypeProfile.js: buildMatchingVector()
Vecteur de matching (6 dimensions de STYLE — consistency exclue)
      ↓ matching.js
matchArchetypes() ──→ archétype dominant (+ secondaire éventuel)
matchReferenceRiders() ──→ coureurs professionnels similaires
      ↓
UI (ArchetypeView.jsx)
```

## Règle n°1 : la structure, jamais le niveau

Ce module ne compare que la **forme** du profil (quelle dimension domine par
rapport aux autres), jamais un niveau de performance absolu. Il ne produit
jamais de phrase du type "tu es aussi fort que X" ou "tu pourrais battre X" —
voir `explanations.js` pour le vocabulaire imposé ("structure proche",
jamais "tu es X").

## Dimensions utilisées

`ARCHETYPE_DIMENSIONS` = `endurance, climbing, punch, sprint, timeTrial,
technical` — **`consistency` est délibérément exclue** : c'est une mesure de
fréquence de pratique (Phase 6A), pas un trait de style de course.

## Pondération (voir consigne §10)

`weight(dimension) = dimension.confidence` (0 si `value` est `null`).
`dim.confidence` (Phase 6A, `profile/confidence.js`) est déjà le produit de
la quantité de preuves et de la qualité des données (mesuré/estimé/vitesse) —
le multiplier une deuxième fois par un facteur de qualité de données
dupliquerait ce facteur. Voir `archetypeProfile.js` pour la justification
complète.

## Algorithme de matching

Distance euclidienne pondérée, en RMS (root-mean-square), calculée
**uniquement sur les dimensions disponibles des deux côtés** (utilisateur ET
cible) :

```
diff_d    = |valeur_utilisateur_d − valeur_cible_d| / 100
distance  = sqrt( Σ(poids_d × diff_d²) / Σ(poids_d) )   pour d disponible des deux côtés
closeness = 1 − distance
```

Une dimension `null` côté utilisateur OU côté cible est **exclue**, jamais
traitée comme un écart de 0 ou 100 (voir `matching.js: computeCloseness`).
`closeness` est un score interne \[0,1] — jamais affiché tel quel (voir
`similarityLabel()` pour la traduction qualitative :
"Profil très proche" / "proche" / "partiellement proche").

## Profil dominant : primaire, secondaire, ou indéterminé

- Si aucune dimension n'est disponible → `"Profil en construction"`.
- Si le meilleur archétype a un `closeness` trop faible (< 0.35) → `"Profil indéterminé"`.
- Sinon, l'archétype le plus proche devient `primary`. Un `secondary` n'est
  annoncé que s'il est à au moins 85 % de la proximité du primaire — sinon
  le profil est présenté seul, jamais forcé dans une combinaison arbitraire
  (voir consigne §2).

## Confiance du matching

`confidence.js` réutilise directement `confidenceLabel()` de Phase 6A
(mêmes seuils, même vocabulaire dans toute l'app) appliqué à :
`(dimensions disponibles / 6) × confiance moyenne de ces dimensions`.
Une seule dimension disponible, même très fiable, ne peut jamais produire
une confiance de matching élevée — la couverture compte autant que la
qualité.

## Coureurs de référence

`references.js` contient ~18 profils, construits par lecture de spécialités
**publiquement documentées** (classements par spécialité, palmarès —
sources : ProCyclingStats, une base de statistiques cyclisme publique ; URL
vérifiée pour chaque coureur). Les valeurs sont des positions RELATIVES
0-100 sur la même échelle que le profil 6A — **pas** des watts, un FTP, un
VO2max ou un classement de performance. Une dimension non documentée
publiquement pour un coureur reste `null` (ex. `technical` pour un rouleur
de route pur) plutôt que d'être inventée.

**Cette base n'est pas un classement.** Aucun coureur n'y est "meilleur"
qu'un autre — c'est une bibliothèque de formes de profils.

## Explications

`explanations.js` construit les phrases à partir des VALEURS RÉELLES du
vecteur de matching (jamais un texte figé par archétype/coureur) : quelles
dimensions dominent, combien sont disponibles, lesquelles manquent. Toujours
la même formule de rappel en fin d'explication coureur : *"Cette comparaison
porte sur le profil de spécialités, pas sur le niveau de performance."*

## Évolution dans le temps

`buildArchetypeTimeline(activities, options)` réutilise
`buildProfileTimeline()` (Phase 6A) tel quel et ajoute juste une passe de
matching par point déjà calculé — aucune donnée fabriquée, aucun calcul
dupliqué. L'UI ne doit afficher une évolution que si l'historique produit au
moins 2 points (même garde que `ProfileView.jsx`).

## Intégrité

- `src/lib/profile/` et `src/lib/progression/` ne sont pas modifiés par
  cette phase.
- `matchArchetypes`/`matchReferenceRiders`/`buildArchetypeTimeline` sont des
  fonctions **pures** de `(profile)`/`(activities, options)` — mêmes
  garanties d'idempotence que le reste du projet.
- Aucune donnée de démo ne peut atteindre ce module autrement qu'en lui
  passant explicitement un profil calculé à partir de cette activité de
  démo (voir `ArchetypeView.jsx`/`AlterEgoView.jsx` : ni l'un ni l'autre ne
  lit l'activité "ouverte" du tableau de bord, seulement l'historique
  persisté du dossier connecté).

## Limites actuelles

- La base de coureurs est volontairement restreinte (~18 profils) et
  route-centrée pour les spécialités les mieux documentées ; le VTT
  technique n'a que 2-3 références solides.
- Le matching ne tient pas compte du sexe, de l'époque ou du type de course
  au-delà des `specialties` déclarées (pas de filtre "coureurs actuels
  uniquement").
- Pas de calcul incrémental pour `buildArchetypeTimeline` (même limite déjà
  documentée pour `buildProfileTimeline` en Phase 6A).

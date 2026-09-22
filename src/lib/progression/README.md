# Système de progression — Alter Ego (Phase 7)

Couche de progression au-dessus du profil cycliste (Phase 6A, voir
`../profile/`). Ne construit ni archétypes, ni matching pro, ni Tour
Simulator — uniquement XP, niveaux, challenges et achievements, comme
fondation pour les phases futures.

## Principe général

```
Activity[] (déjà chargées, profil 6A déjà calculé)
      ↓ un seul passage chronologique (progression.js: computeXpTimeline)
événements XP (xp.js)
      ↓
XP total → niveau/titre (levels.js)
      ↓
achievements (achievements.js, dérivés des mêmes événements)
      ↓
challenges actifs (challenges.js, recalculés à chaque appel)
      ↓
Alter Ego structuré (progression.js: computeProgression)
      ↓
athlete.json (persistence.js — un CACHE, jamais la source de vérité)
```

## Règle n°1 : les données réelles restent souveraines

`computeProgression`/`rebuildProgression` sont des fonctions **pures** de
`(activities, profile)` : elles ne modifient jamais une `Activity`, ne créent
aucune deuxième copie de l'historique, et peuvent être rejouées à l'identique
à tout moment. Si `athlete.json` est perdu ou corrompu,
`rebuildProgression(activities)` reconstruit un état strictement équivalent —
voir `persistence.js`.

## XP — un fait observable, jamais un multiplicateur

`xp.js` n'utilise que des montants plats et documentés (`XP_AMOUNTS`),
jamais `distance * coefficient`. Chaque événement correspond à un fait précis
et daté :

| Type | Déclencheur | XP |
|---|---|---|
| `activity_completed` | Chaque sortie (une fois, dans le passage chronologique) | 15 |
| `distance_milestone` | Palier de distance (20/40/50/100/150/200 km) franchi pour la première fois par UNE sortie | 25 |
| `elevation_milestone` | Palier de D+ sur une sortie (300/500/1000/1500/2000 m) | 25 |
| `duration_milestone` | Palier de durée sur une sortie (1h/2h/3h/5h) | 20 |
| `new_best` | Nouveau record personnel (distance, D+ ou durée) — distinct des paliers ronds ci-dessus | 10 |
| `capability_first` | Première sortie avec puissance mesurée / FC / VTT-gravel | 10 |
| `weekly_streak_milestone` | Streak hebdomadaire atteignant 2/4/8/12 semaines consécutives | 15 |

Une seule sortie peut franchir plusieurs paliers à la fois (ex. une première
sortie de 120 km franchit 20/40/50/100 km) — c'est un fait réel, pas un bug ;
voir `levels.js` pour la courbe qui empêche que cela ne donne pour autant des
dizaines de niveaux d'un coup.

**Mesuré vs estimé** : `capability_first` pour la puissance exige
`flags.hasPower && !flags.powerEstimated` — jamais déclenché par de la
puissance estimée (voir Phase 6A pour la même règle appliquée au profil).

## Niveaux

Voir `levels.js` : chaque montée de niveau coûte 50 XP de plus que la
précédente (100, 150, 200, 250, ...), courbe fermée sous forme close
(`xpThresholdForLevel`), pas une table écrite à la main.

## Titres

Sobres, ancrés cyclisme/analytique (`Rookie` → `Rider` → `Explorer` →
`Rouleur` → `Specialist` → `Expert` → `Veteran`) — jamais de vocabulaire
"gaming mobile".

## Idempotence

`computeXpTimeline`/`computeProgression` ne dépendent QUE de la liste
`activities` fournie : elles ne lisent ni n'écrivent d'état caché quelque
part. Rouvrir la même activité 100 fois n'a aucun effet tant qu'elle
n'apparaît qu'une fois dans le tableau passé en entrée — l'idempotence vient
de l'architecture (recalcul complet à chaque appel), pas d'un verrou
applicatif à maintenir.

## Challenges

`challenges.js` calcule, à chaque appel, le **prochain palier non encore
atteint** par catégorie (distance, D+, endurance, régularité mensuelle,
grimpe accumulée sur 30 jours, efforts punch sur 30 jours) — jamais stocké
comme une liste mutable indépendante. Les challenges **complétés** ne sont
pas un mécanisme séparé : ce sont les événements XP de type `*_milestone`
déjà produits par `xp.js` (voir `progression.js: completedMilestones`).

**Grimpe vs climbing (dimension 6A)** : le challenge "grimpe" personnalisé
porte sur le VOLUME de D+ accumulé sur 30 jours, pas sur `dimensions.climbing.value`
(qui mesure un RYTHME de montée, VAM, pas un volume — les confondre romprait
la distinction que 6A construit délibérément entre "beaucoup de D+" et "bon
grimpeur"). Le challenge "punch" réutilise `profile/activitySignals.js` pour
compter les efforts courts détectés, sans réimplémenter la détection.

## Achievements

`achievements.js` est un catalogue + une projection : il ne parcourt jamais
les activités lui-même, il lit les `achievementId` déjà portés par les
événements XP (voir `xp.js`). Un achievement et l'XP qui l'accompagne
proviennent donc toujours du même fait, à la même date — jamais deux
mécanismes qui pourraient diverger.

## Streaks de régularité

`progression.js` calcule `currentStreak`/`longestStreak` par un index de
semaine locale monotone (`weeks.js: localWeekIndex`, distinct du numéro de
semaine ISO utilisé ailleurs pour l'affichage — voir `history/dateUtils.js`).
Une "semaine active" = au moins une activité datée dans cette semaine locale.
**Ce n'est qu'une statistique de fréquence** — jamais utilisée pour qualifier
la discipline ou la motivation de l'utilisateur (même règle que la dimension
`consistency` du profil 6A).

## Persistence

`athlete.json`, à la racine du dossier choisi par l'utilisateur (voir
`persistence.js`, qui réutilise `storage/activityStore.js:
readTextFile`/`writeTextFile` — pas de deuxième mécanisme de fichiers).
**C'est un cache, pas une source de vérité** : voir `state.js` pour le détail.
`processedActivityIds` sert à détecter "nouveau depuis la dernière visite"
dans l'UI, pas à empêcher un double-comptage d'XP (déjà impossible par
construction, voir Idempotence ci-dessus).

## Mode démo

Le mode démo (`GPXAnalyzer.jsx: isDemo`) ne doit jamais écrire dans
`athlete.json` : `AlterEgoView.jsx` calcule une progression à la volée sur la
seule activité de démonstration, sans jamais appeler `persistence.js` en
dehors d'un dossier de stockage réellement connecté (même garde que
`ProfileView.jsx`/`HistoryDashboard.jsx`).

## Limites actuelles

- Les challenges "grimpe accumulée"/"punch" ont besoin des `samples`
  complets des activités récentes (30 jours) — un résumé léger d'index ne
  suffit pas (même limite que le profil 6A, voir `profile/activitySignals.js`).
- Le rattachement d'un achievement à une activité précise suppose des dates
  fiables ; les activités non datées sont traitées en dernier dans le passage
  chronologique (voir `progression.js: computeXpTimeline`), sans casser le
  calcul mais sans ordre chronologique garanti entre elles.
- Pas de calcul incrémental : `computeProgression` retraite l'historique
  complet à chaque appel (même choix assumé que `computeCyclistProfile` en
  6A) — acceptable au volume actuel, à revisiter si l'historique grandit
  beaucoup.

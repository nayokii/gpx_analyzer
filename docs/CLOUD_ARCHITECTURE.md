# Cloud Sync Foundation, Unified Storage & Automatic Sync (Phases 11A + 11B + 11C)

Synchronisation des sorties entre plusieurs appareils (PC + téléphone).
Phase 11A a posé la fondation cloud (compte, métadonnées, fichier original —
voir sections 1 à 10). Phase 11B a introduit la couche qui **unifie** local
et cloud derrière une seule API (voir sections 11 à 13). Phase 11C rend
cette synchronisation **automatique et robuste** — déclenchée seule au
login/retour en ligne, jamais deux fois en parallèle, avec une file
d'attente pour les uploads ET les suppressions, et des conflits visibles et
actionnables plutôt qu'un simple garde-fou muet (voir sections 14 à 24).

Référence utilisée pour cette intégration : documentation officielle
Supabase et `@supabase/supabase-js` à jour au 24/09/2026 (voir Sources en
fin de document).

## 1. Architecture

```
                         Supabase (offre gratuite)
                    ┌───────────────────────────────┐
                    │ Auth        (email + mot de passe) │
                    │ Postgres    (table `activities`)   │
                    │ Storage     (bucket `activity-files`)│
                    └──────────────┬──────────────────┘
                                   │ HTTPS, anon key publique + JWT de session
                                   │ (aucun secret serveur, aucune fonction Netlify)
                                   ▼
                    src/lib/cloud/          (frontend, voir README.md du module)
                      client.js    Client Supabase (singleton)
                      auth.js      getCurrentUser / onAuthStateChange / signUp / signIn / signOut
                      activities.js  CRUD métadonnées (table activities)
                      files.js     Upload/download fichier original (Storage)
                      sync.js      uploadActivity() = hash + dédup + insert + upload
                      types.js     Modèle CloudActivity, hash de fichier
                      errors.js    Erreurs typées
                      index.js     API publique

src/components/CloudAccountPanel.jsx   UI additive dans DataSourcesView.jsx (compte + synchro)
```

Pourquoi Supabase (voir consigne §2) : le trio Auth + Postgres + Storage
couvre exactement les trois besoins de cette phase (compte utilisateur,
métadonnées d'activité, fichier original) avec un seul fournisseur, un SDK
officiel unique (`@supabase/supabase-js`), et une offre gratuite suffisante
pour un usage personnel (voir section "Limites connues"). Alternative
envisagée et écartée : un backend Node dédié (Express + Postgres) —
rejetée car elle demanderait d'héberger, sécuriser et maintenir un serveur
complet pour un besoin que Supabase couvre déjà avec des policies
déclaratives (Row Level Security) et sans infrastructure à gérer.

Différence de principe avec l'intégration Strava existante
(`src/lib/strava/`, voir `docs/STRAVA_INTEGRATION.md`) : Strava est une
**source externe qui alimente le stockage local** (une fois convertie, une
activité Strava vit dans `activities/` comme n'importe quelle autre sortie).
Le cloud Supabase est, à l'inverse, un **magasin indépendant** : une sortie
synchronisée reste dans le cloud, elle n'est pas rapatriée localement. Ces
deux logiques sont délibérément différentes en 11A (voir section 6).

## 2. Authentification

Email + mot de passe via Supabase Auth (voir consigne §8 : pas de système
maison, pas de multiplication de providers OAuth). Abstraction dans
`src/lib/cloud/auth.js` :

```js
getCurrentUser()       // utilisateur courant (session mémorisée), ou null
onAuthStateChange(cb)  // s'abonne aux changements ; renvoie une fonction de désabonnement
signUp({email, password})
signIn({email, password})
signOut()
```

La persistance de session (localStorage, rafraîchissement automatique du
jeton) est gérée par le SDK Supabase lui-même (`client.js`, options
`persistSession`/`autoRefreshToken`) — aucun mécanisme maison.

Selon la configuration du projet Supabase, une confirmation par email peut
être exigée avant qu'une session soit active après `signUp()` (paramètre par
défaut de Supabase Auth). À activer/désactiver depuis Dashboard → Authentication
→ Providers → Email selon l'usage voulu.

## 3. Base de données (Postgres)

Une seule table, `public.activities` — voir `supabase/schema.sql` pour le
DDL complet et les commentaires. Champs (voir aussi section "Modèle de
données") : métadonnées légères uniquement, jamais les échantillons
(`samples`) ni de donnée dérivée.

## 4. Stockage (Storage)

Bucket privé `activity-files`. Chemin de chaque fichier :
`<user_id>/<activity_id>.<ext>` — le premier segment du chemin est l'id
utilisateur, utilisé directement par les policies Storage (section 5).
Le fichier original (GPX ou FIT, tel qu'importé) y est stocké tel quel,
jamais transformé.

## 5. Sécurité

Priorité n°1 de cette phase (voir consigne §7). Mécanismes :

- **Row Level Security** activée sur `public.activities`, sans exception.
  Chaque policy compare `auth.uid()` (l'utilisateur du JWT vérifié par
  Supabase) à `user_id` — jamais une valeur fournie par le frontend.
- **`user_id` a pour valeur par défaut `auth.uid()`** côté colonne : le
  frontend n'a jamais besoin de l'envoyer, et même s'il envoyait une valeur
  arbitraire, la policy d'insertion (`with check (auth.uid() = user_id)`) la
  rejetterait. Voir `src/lib/cloud/types.js: activityToRow()`, qui n'inclut
  délibérément pas `user_id`.
- **Storage policies** par préfixe de chemin : un utilisateur ne peut
  lire/écrire/supprimer que sous `<son-propre-id>/...`.
- **Aucun secret serveur** : `VITE_SUPABASE_ANON_KEY` est publique par
  conception Supabase (elle finit dans le bundle comme toute variable
  `VITE_*`) — elle ne donne accès à rien par elle-même, contrairement au
  `client_secret` Strava. D'où l'absence de fonction Netlify pour ce module.

**Tests automatisés (voir `src/lib/cloud/*.test.js`)** : chaque module est
testé contre un client Supabase **simulé en mémoire**
(`src/lib/cloud/tests/fakeSupabase.js`) qui reproduit le comportement
observable des policies (une session ne voit/modifie jamais que ses propres
lignes, `user_id` est toujours forcé à l'utilisateur courant, jamais à une
valeur fournie par l'appelant). Ces tests couvrent :
- création de compte, connexion, déconnexion, erreurs d'identifiants ;
- CRUD des métadonnées, y compris l'isolation (l'utilisateur A ne voit/ne
  peut supprimer aucune ligne de l'utilisateur B) ;
- upload/download/suppression de fichier, y compris l'isolation par chemin ;
- déduplication par empreinte (y compris une course entre deux synchros
  concurrentes du même fichier).

**Ce que ces tests NE couvrent PAS** (voir consigne §20) : ils prouvent que
la LOGIQUE de `src/lib/cloud/` se comporte correctement face à un backend qui
applique les règles d'isolation — ils ne prouvent PAS que les policies SQL
réelles (`supabase/schema.sql`), une fois appliquées à un vrai projet
Supabase/Postgres, se comportent bien ainsi. Cette vérification reste
**manuelle** : voir `supabase/schema.sql` section 4 pour le protocole exact
(deux comptes réels, vérifier qu'aucun ne peut lire/modifier les données de
l'autre). **Cette vérification manuelle n'a pas été effectuée dans cette
phase** (aucun projet Supabase réel n'a été créé) — à faire avant tout usage
avec des données réelles de plusieurs utilisateurs.

## 6. Local vs Cloud (état après la Phase 11B)

| | Utilisateur non connecté | Utilisateur connecté au cloud |
|---|---|---|
| Source de vérité | Local (dossier choisi par l'utilisateur) | Cloud (Postgres + Storage) |
| Rôle du local | Seul magasin | Cache/copie locale + secours hors-ligne, jamais supprimé |
| Consommé par | Profil, Alter Ego, Archétype, Tour, Historique — via `activityRepository.js` | Idem, même code, même composants |
| Multi-appareil | Non (par construction) | Oui |

Voir section 11 pour le détail du repository unifié qui rend cette table
possible **sans dupliquer aucun moteur métier** (voir consigne 11B §5/§31) :
`computeCyclistProfile`, `computeProgression`, `matchArchetypes`,
`simulateTour`, `computeHistoryAnalytics` reçoivent toujours un `Activity[]`
classique — seule sa provenance a changé.

Ce qui reste vrai depuis la Phase 11A (inchangé) :
- le fichier original (GPX/FIT) reste la source de vérité d'une activité ;
- une activité `demo` n'atteint jamais le cloud (voir section 13) ;
- aucune donnée locale n'est supprimée du seul fait de se connecter.

## 7. Modèle de données

Le fichier original (GPX/FIT) reste la source de vérité — voir consigne
§18. `public.activities` ne stocke que ce qu'il faut pour lister/trier sans
télécharger chaque fichier :

```
id, user_id, local_id, source_type, source_file_name, source_format,
file_hash, started_at, distance, duration, moving_time, elevation_gain,
elevation_loss, avg_speed, avg_power, avg_cadence, flags,
created_at, updated_at
```

Jamais stockés dans le cloud (voir consigne §18) : `samples`, `CyclistProfile`,
`AlterEgo`, `Archetype`, résultats de Tour — tout cela reste dérivé côté
client à partir du fichier original, comme pour une activité locale.

**Id stable** (voir consigne §16, et consigne 11B §16/§27) : l'`id` cloud
(`uuid`, généré par Postgres) reste un espace d'identifiants SÉPARÉ de l'`id`
local (`generateId()` dans `src/lib/types.js`, format `timestamp36-random`).
Depuis la Phase 11B, `local_id` (jusque-là informationnel) devient la **clé
de fusion** utilisée par `src/lib/storage/activityRepository.js:
mergeActivitySummaries()` : une ligne cloud dont `local_id` correspond à un
`activity.id` local désigne la MÊME activité (statut `synced`), jamais deux
entrées distinctes. Quand une activité cloud-only est matérialisée sur un
nouvel appareil (voir section 13), elle reçoit `activity.id = local_id` (ou,
à défaut, l'`id` cloud lui-même) — garantissant qu'un futur rapprochement la
reconnaît de façon stable, sans jamais compter deux fois la même sortie dans
la progression (XP/achievements, voir AlterEgoView.jsx).

**Déduplication** (voir consigne §17) : uniquement par empreinte SHA-256 du
contenu brut du fichier (`file_hash`, contrainte `UNIQUE (user_id,
file_hash)`) — jamais par date+distance, qui peuvent coïncider entre deux
sorties réellement différentes. Voir `src/lib/cloud/types.js:
computeFileHash()` et `src/lib/cloud/sync.js`.

## 8. Variables d'environnement

Voir `.env.example` à la racine. Toutes deux publiques par conception
Supabase (aucune n'a besoin d'être cachée côté serveur) :

```
VITE_SUPABASE_URL=
VITE_SUPABASE_ANON_KEY=
```

À renseigner dans `.env` (jamais commité) en local, et dans les variables
d'environnement du site Netlify en production (Site settings → Environment
variables).

## 9. Déploiement (Netlify)

Aucune fonction serveur nécessaire pour le cloud (contrairement à Strava) :
Supabase peut être appelé directement et en sécurité depuis le frontend
grâce à la Row Level Security (voir consigne §12). `netlify/functions/`
continue de ne contenir que les fonctions Strava, inchangées.

Changement lié fait dans cette phase : `netlify.toml` passe de
`NODE_VERSION = "20"` à `"22"` — Node 20 a atteint sa fin de vie en avril
2026, et `@supabase/supabase-js` a cessé de supporter Node 20 à partir de la
version 2.110.0 (le SDK n'est utilisé que côté navigateur ici, mais Node
tourne aussi au moment du `npm install`/`vite build` sur Netlify).

## 10. Limites connues / à vérifier

- **Offre gratuite Supabase** (vérifiée au 24/09/2026, à reconfirmer sur
  supabase.com/pricing avant un usage réel) : 500 Mo de base de données,
  1 Go de Storage, 5 Go d'egress/mois, 2 projets actifs gratuits max, et
  surtout — **un projet gratuit sans requête pendant 7 jours consécutifs est
  automatiquement mis en pause** (il faut alors le réactiver manuellement
  depuis le dashboard). C'est la limite la plus susceptible de surprendre un
  usage personnel peu fréquent.
- **Vérification d'isolation multi-utilisateur réelle non effectuée** (voir
  section 5) : aucun projet Supabase n'a été créé pendant cette phase, donc
  aucun test contre un vrai Postgres+RLS n'a pu être exécuté. À faire avant
  tout usage avec des données sensibles de plusieurs comptes.
- **Seuls les fichiers GPX/FIT sont synchronisables** en 11A : une sortie
  `demo` ou déjà importée depuis Strava (dont le fichier local est un blob
  JSON `.strava`, pas un GPX/FIT) ne peut pas encore être synchronisée —
  `CloudUnsupportedSourceError` le signale explicitement.
- **Confirmation par email** : selon la configuration par défaut du projet
  Supabase, `signUp()` peut exiger une confirmation par email avant que la
  session soit active — à vérifier/ajuster dans le dashboard du projet créé.
- **Vulnérabilités npm préexistantes** (`vite`/`vitest`/`esbuild`, outillage
  de développement uniquement, jamais expédiées au bundle) : sans lien avec
  cette phase ni avec `@supabase/supabase-js` — voir `npm audit`.
- **(Résolu en Phase 11C)** ~~Suppression cloud best-effort sans file
  d'attente~~ — voir section 15 : une suppression cloud en échec est
  maintenant mise en attente et rejouée automatiquement.
- **(Résolu en Phase 11C)** ~~Pas de synchronisation automatique~~ — voir
  section 14 : déclenchée au login, au retour en ligne, et manuellement.
- **Fichiers Storage orphelins** (Phase 11C) : voir section 22 — une
  suppression/un remplacement ne nettoie jamais le fichier original côté
  Storage, seulement la ligne de métadonnées.

## 11. Repository unifié (Phase 11B)

`src/lib/storage/activityRepository.js` exporte
`createActivityRepository({ rootHandle, cloudUser, userSettings })`, qui
retourne `{ listActivities, loadActivityDetail, loadActivityDetails,
saveActivity, deleteActivity, hasActivity, sync }`. Utilisé via un hook React
(`src/components/useActivityRepository.js: useActivityRepository(storage,
userSettings)`) qui construit le repository et suit l'état d'authentification
cloud — HistoryView/HistoryDashboard/ProfileView/AlterEgoView/ArchetypeView/
TourView l'appellent tous, au lieu d'importer directement
`../lib/storage/activityStore.js` comme avant 11B.

Comportement selon le contexte :
- **`cloudUser` absent** : chaque méthode est un pur passe-plat vers
  `activityStore.js` — comportement byte-identique à avant la Phase 11B (voir
  les tests "comportement 11A inchangé" de `activityRepository.test.js`).
- **`cloudUser` présent** : `listActivities()` fusionne résumés locaux et
  cloud (voir `mergeActivitySummaries()`, fonction pure) et annote chaque
  entrée d'un `syncStatus` : `local-only` / `cloud-only` / `synced` /
  `conflict`. `loadActivityDetail(id)` sert d'abord le cache local ; si
  absent, télécharge le fichier original depuis Storage, le reparse avec les
  mêmes parsers que l'import manuel (`../parsers/`), reconstruit l'`Activity`
  et l'écrit en cache local (voir section 13).

## 12. Performance (voir consigne 11B §26/§27)

Aucun scénario "login → tout télécharger → tout reparser" : `listActivities()`
ne lit que des métadonnées (léger, un aller-retour Postgres). Le détail
complet (`samples`) n'est chargé qu'à la demande, via
`loadActivityDetails(summaries)` — équivalent de
`loadCachedActivityDetails()` mais plafonné à 4 matérialisations cloud
concurrentes (`DETAIL_LOAD_CONCURRENCY`) pour ne jamais saturer le réseau.
Une fois matérialisée, une activité cloud-only est mise en cache local : elle
n'est plus jamais retéléchargée (les fichiers Storage sont écrits une seule
fois, jamais modifiés — voir section 4, pas de policy UPDATE), ce qui rend
inutile toute logique de comparaison `updated_at`.

Détail d'implémentation notable : `../storage/activityStore.js: saveActivity()`
fait un lire-modifier-écrire non atomique sur `index.json`. Des
matérialisations concurrentes (plusieurs sorties cloud-only ouvertes en
parallèle) pouvaient donc se marcher dessus et perdre une entrée d'index —
détecté par le test d'intégration §30 pendant cette phase, corrigé en
sérialisant les écritures locales du repository (`withLocalWriteLock`),
jamais les téléchargements réseau (qui restent concurrents).

## 13. Synchronisation — manuelle et import (Phase 11B, base réutilisée telle quelle en 11C)

`repository.sync({ onProgress, force })` réconcilie les DEUX sens en une
seule action : upload de chaque sortie `local-only`, téléchargement+
matérialisation de chaque sortie `cloud-only`, séquentiellement (progression
exacte, jamais une rafale de requêtes). Les sorties déjà `synced` ne sont
jamais retouchées. `force: true` (bouton "Synchroniser"/"Réessayer" de
CloudAccountPanel.jsx) ignore le cooldown (voir section 17) mais respecte
toujours la déduplication d'un cycle déjà en cours.

Import d'une nouvelle sortie (GPXAnalyzer.jsx: `loadFile()`) : sauvegarde
locale IMMÉDIATE (attendue), puis upload cloud en ARRIÈRE-PLAN, jamais
attendu par l'appelant (voir consigne 11C §10 : "l'import ne doit pas être
rendu inutilement lent par le réseau") — `saveActivity()` retourne
`{ activity, cloudSyncPromise }`, et l'UI met à jour son message dès que
`cloudSyncPromise` se résout ("✓ Sortie synchronisée" ou "◌ Synchronisation
en attente").

## 14. Synchronisation automatique (Phase 11C, consigne §1/§2/§3)

Trois déclencheurs, tous dans le hook React
(`src/components/useActivityRepository.js: useActivityRepository()`) —
JAMAIS un second mécanisme de synchronisation, toujours le même
`repository.sync()` :
- **Login** (et "ouverture de l'app si déjà connecté" — le même évènement :
  `cloudUser` passe de `null` à un utilisateur réel dès que `getCurrentUser()`
  résout une session déjà persistée).
- **Retour en ligne** (`window.addEventListener("online", ...)`).
- **Manuel** (bouton de CloudAccountPanel.jsx, avec `force: true`).

**Déduplication** (consigne §2) : `src/lib/storage/activityRepository.js`
tient un coordinateur MODULE-LEVEL (pas par instance de repository — chaque
vue construit la SIENNE via le hook), une `Map` indexée par compte cloud
(`inFlightByAccount`). Un `sync()` déjà en cours est PARTAGÉ : les appels
supplémentaires (ex. plusieurs vues montées réagissant au même évènement
"online") reçoivent la même promesse et le même résultat, y compris leur
propre callback de progression (fan-out vers tous les appelants en attente)
— jamais deux réconciliations parallèles pour le même compte.

**Cooldown** (consigne §3) : `SYNC_COOLDOWN_MS = 10 s`. Un `sync()` NON
forcé appelé moins de 10 s après la fin du précédent renvoie directement le
dernier résultat connu plutôt que de relancer un cycle réseau complet —
absorbe une rafale d'évènements "online" (ex. un Wi-Fi qui flotte) sans
jamais bloquer ni spammer le cloud.

## 15. File d'attente — upload ET suppression (Phase 11C, consigne §4/§5)

`src/lib/storage/syncQueue.js` porte désormais deux types d'opération,
`upload` et `delete`, dédoublonnées par id (une activité n'a jamais qu'UNE
opération en attente — supprimer une sortie dont l'upload était encore en
attente REMPLACE cet upload par une suppression, jamais les deux). Cette
file sert surtout d'indicateur rapide pour l'UI ("◌ N opérations en
attente") : la réconciliation réelle est toujours recalculée fraîche par
`repository.sync()`/`listActivities()`.

- **Upload en échec** → `enqueueUpload()`. Prochaine `sync()` (auto ou
  manuelle) : retrouvée comme `local-only`, réessayée.
- **Suppression en échec** (`deleteActivity()` supprime toujours LOCALEMENT
  tout de suite ; si la suppression cloud échoue) → `enqueueDelete()`.
  `repository.sync()` rejoue en tout premier les suppressions en attente
  (`processQueuedDeletes()`), avant même de recalculer la fusion — une
  suppression n'est donc jamais perdue ni annulée par une resynchronisation.

## 16. Idempotence et non-résurrection (Phase 11C, consigne §6)

Rejouer une opération ne doit jamais créer de doublon ni annuler une
suppression légitime :
- **Upload répété** : la contrainte `UNIQUE (user_id, file_hash)` (voir
  section 3) + `CloudDuplicateActivityError` garantissent qu'uploader 3 fois
  le même fichier ne crée qu'UNE seule ligne cloud (voir
  `activityRepository.test.js`, describe "idempotence").
- **Non-résurrection après suppression distante** (bug réel trouvé et
  corrigé pendant cette phase, voir section 24) : une activité locale dont
  la ligne cloud a disparu (supprimée par un AUTRE appareil) ne doit JAMAIS
  être silencieusement re-uploadée. Le repository marque `source.sourceId`
  (champ déjà présent dans le modèle `Activity`, voir `../types.js`) dès
  qu'une synchronisation confirme un lien avec une ligne cloud précise
  (`materializeFromCloud`, `saveActivity`, upload de `sync()`,
  `applyConflictResolution`). Si, plus tard, `mergeActivitySummaries()`
  trouve une activité locale avec `source.sourceId` déjà renseigné mais
  SANS ligne cloud correspondante, elle la marque `syncStatus:
  "cloud-deleted"` (pas `"local-only"`) — `runSync()` la supprime alors
  localement au lieu de la re-uploader, honorant la suppression plutôt que
  de l'annuler.

## 17. Conflits — détection et résolution (Phase 11C, consigne §13-16)

Détection inchangée depuis la Phase 11B : écart de métadonnées (distance,
tolérance 50 m) entre une entrée locale et sa correspondante cloud partageant
la même clé de fusion — jamais par comparaison d'empreinte de fichier (coût
disproportionné pour un cas structurellement quasi impossible, les fichiers
Storage n'étant jamais réécrits).

**Résolution — jamais automatique** (consigne §13) : `resolveConflict({choice})`
(fonction PURE, sans I/O, dans `activityRepository.js`) traduit un choix
`'local' | 'cloud' | 'cancel'` en action `'upload-local' | 'download-cloud' |
'none'`. `repository.applyConflictResolution(id, choice)` exécute réellement
cette action :
- `'local'` : supprime l'ancienne ligne+fichier cloud, réenvoie le fichier
  local — qui devient la version faisant foi des deux côtés.
- `'cloud'` : retélécharge le fichier cloud, écrase la copie locale
  (`materializeFromCloud(..., { replaceLocal: true })` — supprime d'abord
  l'ancien fichier local pour ne jamais laisser d'orphelin si sa date a changé).
- `'cancel'` : ne modifie RIEN ; le conflit reste signalé à la prochaine liste.

**UI** (`CloudAccountPanel.jsx: ConflictResolver`) : une carte par conflit,
uniquement les informations réellement disponibles (distance, date, durée,
source — jamais une valeur inventée, `—` sinon), avec "Garder cette
version" / "Garder la version cloud" / "Plus tard".

## 18. État honnête (Phase 11C, consigne §7/§8)

7 états, dérivés (`deriveSyncStatus()` dans CloudAccountPanel.jsx), jamais
stockés séparément : `idle` (pas encore vérifié) → `offline` (hors ligne,
prioritaire sur tout le reste) → `syncing` (cycle en cours) → `conflict`
(au moins un conflit non résolu) → `error` (dernière synchro interrompue) →
`pending` (sorties ou opérations en attente) → `synced` (tout réconcilié).
Jamais deux messages contradictoires affichés en même temps.

## 19. Ne jamais bloquer l'application (Phase 11C, consigne §9/§10)

Aucun écran "Synchronisation obligatoire..." : `useUnifiedActivities()`
(consommé par Historique/Profil/Alter Ego/Archétype/Tour) continue de servir
les données déjà connues pendant qu'une synchro tourne en arrière-plan.
L'import (voir section 13) ne bloque plus sur le réseau.

## 20. Invalidation des caches et rafraîchissement des vues (Phase 11C, consigne §11/§12)

Les caches existants (`activityCache.js`, `derivedCache.js`, Phase 9E) sont
RÉUTILISÉS tels quels — aucun nouveau système de cache. Leur invalidation
par id (`invalidateActivityCache`) était déjà appelée par le repository
depuis la Phase 11B à chaque écriture/suppression locale ; `derivedCache.js`
s'invalide de lui-même par sa signature (id+version des activités passées).

Ce qui manquait pour une vraie réactivité multi-vues : `onSyncCompleted()`
(pub/sub MODULE-LEVEL dans `activityRepository.js`) notifie quand une
synchronisation a RÉELLEMENT changé quelque chose (`uploaded`/`downloaded`/
`deletedLocally`/`conflictsResolved` > 0 — jamais pour un cycle sans
changement, voir section 16). `useUnifiedActivities()` s'y abonne et se
rafraîchit automatiquement — une vue déjà ouverte (ex. Profil sur le
téléphone) se met donc à jour toute seule quand une synchro déclenchée
ailleurs (le PC, ou l'évènement "online" de cette même vue) apporte du
nouveau, sans navigation ni rechargement.

## 21. Historique unifié et mode démo (inchangé depuis la Phase 11B)

`HistoryView.jsx` affiche un unique "MES SORTIES" avec un petit indicateur
☁ par ligne (`synced` / `cloud-only` / `local-only` / `conflict` /
`cloud-deleted`) — jamais deux listes séparées. Une activité `demo` n'atteint
structurellement jamais le cloud : `GPXAnalyzer.jsx: loadDemo()` ne
l'enregistre jamais via `saveActivity`/le repository, quel que soit l'état de
connexion cloud — vérifié explicitement par un test (voir
`GPXAnalyzer.test.jsx`, "Phase 11C §22"). Une activité Strava reste
`source_type: "strava"` (fichier `.strava`, pas GPX/FIT) : non
synchronisable, sans logique spéciale ajoutée.

## 22. Limite connue — fichiers Storage orphelins

`deleteCloudActivity()` (et la résolution de conflit) ne suppriment que la
ligne de métadonnées (`public.activities`), jamais le fichier original
correspondant dans Supabase Storage (`activity-files`) : un fichier
supprimé/remplacé reste orphelin (facturé dans le quota Storage, jamais
revisité par aucun code). Sans conséquence fonctionnelle (les policies RLS
empêchent toujours d'y accéder par un autre chemin que la ligne supprimée),
mais un nettoyage périodique (ex. une fonction planifiée comparant Storage
et `public.activities`) serait nécessaire avant un usage prolongé à grande
échelle — hors périmètre de cette fondation.

## 23. Fragilité des tests — synchronisation automatique et ordonnancement

La synchronisation automatique au login (voir section 14) se déclenche dès
qu'un composant utilisant `useActivityRepository()` est monté avec un
utilisateur déjà connecté — y compris dans les tests, où elle part en
arrière-plan (jamais attendue par le composant). Comme le client Supabase
simulé est un singleton reconfiguré à chaque test
(`__setSupabaseClientForTests`), une synchronisation encore en vol d'un test
précédent pourrait sinon s'exécuter par erreur contre le backend simulé du
test SUIVANT. Les fichiers de test concernés laissent donc une micro-pause
(`await new Promise((r) => setTimeout(r, 0))`) dans leur `afterEach`, après
`cleanup()` et AVANT de neutraliser le client, pour laisser cette synchro se
terminer contre son propre backend. Ceci n'a aucun équivalent en production
(le client Supabase n'y est jamais remplacé en cours de session).

## 24. Prochaine phase (11D recommandée)

- Nettoyage périodique des fichiers Storage orphelins (voir section 22).
- File d'attente de suppression Storage (le fichier original, pas seulement
  la ligne de métadonnées).
- Résolution de conflit "assistée" (proposer automatiquement de garder la
  version la plus récente par défaut, tout en laissant toujours le choix).
- Migration (à la demande) du dossier local existant en un clic, en
  réutilisant `repository.sync()` tel quel.

## Sources

- [Supabase — Row Level Security](https://supabase.com/docs/guides/auth/row-level-security)
- [Supabase — Storage access control](https://supabase.com/docs/guides/storage/security/access-control)
- [Supabase — Pricing](https://supabase.com/pricing)
- [@supabase/supabase-js sur npm](https://www.npmjs.com/package/@supabase/supabase-js)

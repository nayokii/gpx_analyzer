# Intégration Strava (Phase 9C)

Strava est une **troisième source d'activités**, à côté de l'import manuel
GPX/FIT : une fois connectée, elle alimente exactement le même modèle
`Activity` (voir `src/lib/types.js`) et converge donc dans les mêmes moteurs
(profil, progression, archétype, historique, analytics) sans qu'aucun de ces
moteurs n'ait besoin de savoir que Strava existe.

Référence utilisée pour toute cette intégration : la documentation officielle
Strava à jour au 22/09/2026 —
[Authentication](https://developers.strava.com/docs/authentication/),
[Getting Started](https://developers.strava.com/docs/getting-started/),
[API Reference](https://developers.strava.com/docs/reference/).

## 1. Architecture

```
Strava API  ⇄  netlify/functions/strava-*.js  (client_secret, côté serveur)
                        ▲
                        │ (exchange / refresh / revoke — jamais le secret)
                        ▼
src/lib/strava/         (frontend, aucun secret)
  auth.js       OAuth : URL d'autorisation, lecture callback, jetons
  api.js        Appels HTTP Strava v3 (liste activités, streams)
  adapter.js    SummaryActivity + streams → Activity (réutilise analysis.js/normalize.js)
  sync.js       Orchestration : 1ère import / synchro incrémentale / dédup
  storage.js    Persistance de l'état connexion/synchro (strava.json)
  types.js      Modèle StravaConnectionState + mapping sport_type → sportType
  errors.js     Erreurs typées (jamais un message contenant un jeton)
  index.js      API publique (seule surface importée par l'UI/GPXAnalyzer.jsx)

src/components/DataSourcesView.jsx   UI "Sources de données" (Strava + stockage local)
```

Principe directeur : **l'adaptateur ne fait que mettre les données Strava
dans la même forme que les parsers GPX/FIT** (`{lat, lon, ele, time, hr, cad,
power, temp, distanceMeasured, speedMeasured}`), puis réutilise tel quel
`computeAnalysis()` + `toActivity()`. Aucune business logic de profil/
progression/archétype n'a été modifiée — ils reçoivent juste plus
d'`Activity[]`.

## 2. Pourquoi un petit serveur est nécessaire (sécurité)

**Le `client_secret` Strava ne doit jamais atterrir dans le bundle Vite** :
tout ce qui est sous `src/` est livré tel quel au navigateur, donc lisible
par n'importe qui. Ce projet est 100% frontend (pas de backend historique),
donc l'échange de code contre jetons — qui *exige* le `client_secret` selon
la doc Strava — ne peut pas se faire directement depuis `src/`.

Solution retenue, la plus petite possible compte tenu de l'existant : ce
projet est déjà déployé sur **Netlify** (voir `netlify.toml`), qui fournit des
fonctions serverless sans infrastructure à gérer. Trois petites fonctions
(`netlify/functions/strava-exchange.js`, `strava-refresh.js`,
`strava-revoke.js`) sont le SEUL endroit du projet qui lit
`STRAVA_CLIENT_SECRET` (via `process.env`, jamais `import.meta.env`/`VITE_*`).
Elles ne font rien d'autre que relayer l'appel à Strava en y ajoutant le
secret côté serveur.

Alternative envisagée et écartée : un serveur Express dédié. Rejetée car ce
projet a déjà Netlify comme cible de déploiement — ajouter Express aurait
dupliqué une infrastructure déjà disponible gratuitement, pour un gain nul.

### Développement local

- `npm run dev` (Vite seul) fait tourner toute l'app SAUF les fonctions
  Strava (`/.netlify/functions/*` n'existe pas sous Vite seul).
- Pour tester Strava en local, utiliser **Netlify CLI** :
  ```bash
  npm install -g netlify-cli   # une seule fois
  netlify dev
  ```
  `netlify dev` fait tourner Vite ET les fonctions sur une seule origine
  locale, en injectant les variables de `.env`. C'est la "plus petite
  architecture" pour du développement local sans jamais exposer le secret :
  aucun code custom, juste l'outil officiel Netlify.

### Où sont les jetons une fois obtenus ?

Une fois l'échange fait par la fonction serveur, elle renvoie `access_token`
et `refresh_token` **au frontend** (pas de choix : le frontend est celui qui
appelle ensuite directement l'API Strava — `GET /athlete/activities`,
`GET /activities/{id}/streams` — pour lire les activités ; il n'y a pas de
backend qui proxy CES appels-là, seulement l'échange/rafraîchissement de
jetons, qui exigent le secret). C'est une caractéristique assumée d'une appli
"single-player" locale (l'utilisateur == le développeur de l'intégration,
comme le documente Strava pour le mode par défaut de l'API).

Ces jetons sont stockés dans le dossier local choisi par l'utilisateur
(`strava.json` à la racine, voir §5), **pas dans `localStorage`** : le
dossier est déjà le mécanisme de confiance de toute l'application (c'est là
que vivent les activités elles-mêmes), il n'ajoute pas de surface
d'exposition supplémentaire propre au navigateur (extensions, autres onglets
du même domaine, etc.), contrairement à `localStorage`. Compromis explicite :
si quelqu'un a un accès disque à ce dossier, il peut lire ces jetons — la
seule façon d'éliminer ce risque serait un backend qui ne renvoie jamais le
jeton au client, incompatible avec l'architecture 100% locale actuelle. Pour
une évolution multi-utilisateur future (voir §8), c'est le premier point à
revoir.

## 3. Scopes

Seul `activity:read` est demandé (voir `auth.js: REQUESTED_SCOPE`) — jamais
`activity:write` ni `profile:write`. Strava peut accorder moins que demandé :
`assertHasActivityReadScope()` vérifie le scope RÉELLEMENT accordé (renvoyé
par Strava dans la réponse) avant de considérer la connexion utilisable, et
lève une erreur explicite sinon plutôt que de supposer que la demande a été
acceptée telle quelle.

## 4. Cycle de vie des jetons

- `access_token` : valide 6h (doc Strava). `isTokenExpired()` applique une
  marge de sécurité de 5 min.
- `refresh_token` : utilisé pour obtenir un nouvel `access_token` ; Strava
  peut le faire tourner (rotation) — `ensureFreshTokens()` remplace toujours
  l'ancien par celui renvoyé, jamais une hypothèse d'immuabilité.
- Rafraîchi automatiquement en tout début de `syncStrava()`, et persisté
  immédiatement (avant même de lister les activités) pour ne jamais perdre un
  rafraîchissement en cas d'erreur plus tard dans la synchro.
- Déconnexion : révocation via `/oauth/revoke` (endpoint recommandé par
  Strava ; l'ancien `/oauth/deauthorize` est documenté comme retiré au
  01/06/2027) puis `strava.json` réinitialisé. Si la révocation réseau
  échoue, la déconnexion locale est appliquée quand même plutôt que de
  bloquer l'utilisateur.

## 5. Stockage local

Un seul nouveau fichier à la racine du dossier choisi par l'utilisateur,
`strava.json` (même mécanisme que `athlete.json`, voir
`src/lib/progression/persistence.js`) : jetons, athlète, curseur de synchro,
ids déjà importés, résumé de la dernière synchro. **Aucune activité n'y est
stockée** : une fois converties par `adapter.js`, les activités Strava
rejoignent `activities/` exactement comme un GPX/FIT (voir
`src/lib/storage/activityStore.js: saveActivity`), avec en plus le JSON brut
Strava (SummaryActivity + streams) conservé sous `<date>_<id>.strava` — pas
`.strava.json` : le suffixe `.json` est réservé aux fichiers d'Activity
normalisée, `rebuildIndex()` les reconnaît par cette seule extension.

## 6. Synchronisation

- **Première connexion** : `state.syncCursor` est `null` → toutes les pages
  sont récupérées (`listAllAthleteActivities`, pagination automatique).
- **Synchros suivantes** : `after=<syncCursor>` est transmis à l'API — jamais
  un re-téléchargement complet. Le curseur avance jusqu'à la date de la plus
  récente activité VUE (même ignorée : non-cycliste ou doublon), pour ne
  jamais la revoir inutilement.
- Seuls les types Strava cyclistes sont importés (`Ride`, `VirtualRide`,
  `GravelRide`, `MountainBikeRide`, `EBikeRide`, `Velomobile`, `Handcycle` —
  voir `types.js: CYCLING_SPORT_TYPES`) : les moteurs de ce projet supposent
  tous une activité vélo (cadence en rpm, puissance vélo...).
- **Résiliente** : l'échec d'une activité (flux indisponible, pas de GPS,
  donnée malformée) est consigné dans `summary.errors` et n'interrompt pas
  les suivantes.

## 7. Déduplication

Jamais de suppression silencieuse en cas de doute (consigne explicite).
Deux niveaux :
1. Id Strava déjà connu (`state.importedStravaIds`) → toujours ignoré (évite
   les doublons lors d'une resynchro qui chevaucherait le curseur).
2. Correspondance date (±120s) ET distance (±2%, min 300m) avec une activité
   DÉJÀ en historique (import manuel FIT/GPX de la même sortie) → traité
   comme doublon probable et ignoré. En dehors de cette tolérance serrée,
   l'activité est importée — jamais ignorée "par excès de prudence".

## 8. Limites actuelles / évolution multi-utilisateur

- Une activité Strava enregistrée sans position GPS (ex. home trainer sans
  capteur GPS) n'est pas importable par cette voie (le moteur d'analyse
  exige des points GPS) : elle apparaît en erreur partielle dans le résumé de
  synchro plutôt que d'être ignorée silencieusement.
- Les jetons vivent dans le dossier local (voir §2) : adapté à un usage
  "single-player" (un seul athlète = l'utilisateur de l'app). Pour une
  évolution multi-utilisateur (plusieurs athlètes, backend partagé), il
  faudrait : (a) un vrai backend qui conserve les jetons côté serveur (base
  de données par utilisateur, jamais renvoyés au client), (b) que le
  frontend n'appelle plus directement `www.strava.com/api/v3/*` mais un proxy
  serveur qui y ajoute le jeton lui-même, (c) une authentification applicative
  (comptes) qui n'existe pas aujourd'hui. Rien dans `src/lib/strava/` n'a été
  conçu pour empêcher cette évolution (la séparation auth/api/adapter/sync
  existe justement pour que `api.js`/`auth.js` puissent être remplacés par des
  appels à ce futur proxy sans toucher `adapter.js`/`sync.js`), mais elle
  n'est pas implémentée dans cette phase (hors périmètre, voir consigne).
- Au-delà de 10 athlètes connectés, Strava impose une demande d'extension de
  quota (voir doc "Getting Started" — non pertinent en usage single-player).

## 9. Configuration (`.env`)

Voir `.env.example` à la racine du projet pour le détail commenté de chaque
variable. Résumé :

| Variable | Où | Rôle |
|---|---|---|
| `VITE_STRAVA_CLIENT_ID` | Frontend (bundlée) | Client ID Strava (pas un secret) |
| `VITE_STRAVA_REDIRECT_URI` | Frontend (bundlée) | Doit correspondre exactement à l'URL configurée sur strava.com/settings/api |
| `STRAVA_CLIENT_ID` | Fonctions serveur uniquement | Réutilisé côté serveur pour l'échange/refresh/revoke |
| `STRAVA_CLIENT_SECRET` | Fonctions serveur uniquement | **Jamais préfixé `VITE_`** — c'est ce préfixe qui ferait fuiter la valeur dans le bundle |

Obtenir un Client ID/Secret : créer un compte Strava, puis une application
sur [strava.com/settings/api](https://www.strava.com/settings/api). L'URL de
callback doit y être configurée à l'identique de `VITE_STRAVA_REDIRECT_URI`.

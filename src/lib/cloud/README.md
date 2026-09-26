# `src/lib/cloud/` — Cloud Sync Foundation (Phase 11A)

Voir `docs/CLOUD_ARCHITECTURE.md` à la racine du dépôt pour le contexte complet
(pourquoi Supabase, modèle de données, sécurité, limites connues, prochaine
phase). Ce fichier documente uniquement l'organisation interne du module.

```
client.js    Client Supabase (singleton paresseux, config via VITE_SUPABASE_*)
auth.js      Authentification (getCurrentUser / onAuthStateChange / signUp / signIn / signOut)
activities.js  CRUD des métadonnées d'activité cloud (table public.activities)
files.js     Upload/download du fichier original FIT/GPX (Supabase Storage)
sync.js      Orchestration : uploadActivity() = hash + dédup + insert + upload
types.js     Modèle CloudActivity, conversions, hash de fichier
errors.js    Erreurs typées (jamais un message contenant un jeton/mot de passe)
index.js     API publique — seule surface importée par l'UI/GPXAnalyzer.jsx
```

## Principes

- **Additif, jamais intrusif** : ce module n'importe rien depuis
  `../storage/`, `../profile/`, `../progression/`, `../archetypes/` ni
  `../simulator/`, et rien dans ces modules n'importe depuis `cloud/`. Le
  stockage local (`../storage/activityStore.js`) continue de fonctionner
  exactement comme avant — voir consigne §4.
- **Pas de fusion ICI** : contrairement à Strava (`../strava/`), qui convertit
  ses données pour les faire converger dans le stockage local, une activité
  synchronisée par ce module reste dans le cloud — elle n'est jamais
  rapatriée automatiquement dans `activities/`. La fusion (lecture unifiée
  local+cloud consommée par Profil/Alter Ego/Archétype/Tour/Historique) vit
  dans `../storage/activityRepository.js` (Phase 11B), qui est le SEUL
  consommateur de ce module côté "lecture d'historique" — ce module lui-même
  reste inchangé depuis la Phase 11A.
- **Aucun secret serveur** : `VITE_SUPABASE_ANON_KEY` est publique par
  conception Supabase — la sécurité vient de la Row Level Security
  (`supabase/schema.sql`), jamais d'un secret caché. D'où l'absence de
  fonction Netlify pour ce module (contrairement à `netlify/functions/strava-*`).
- **Le fichier original reste la source de vérité** : `public.activities` ne
  stocke que des métadonnées légères (voir `types.js: activityToRow`) —
  jamais `samples`, jamais de profil/archétype/progression dérivés.
- **Déduplication par empreinte** : `computeFileHash()` (SHA-256 du contenu
  brut) est la seule base de détection de doublon, jamais une comparaison
  date+distance (voir consigne §17).

## Tests

Chaque module est testé avec un client Supabase **simulé** (objet JS imitant
`.auth.*`, `.from(...).select()...`, `.storage.from(...).upload()`), injecté
via `client.js: __setSupabaseClientForTests()` — même principe que
`fetchImpl` injecté dans `../strava/auth.js`. Voir
`docs/CLOUD_ARCHITECTURE.md` section "Tests" pour ce qui est couvert par ces
tests et ce qui nécessite une vérification manuelle contre un vrai projet
Supabase (isolation multi-utilisateur réelle, notamment).

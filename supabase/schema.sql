-- Phase 11A — Cloud Sync Foundation
--
-- À exécuter UNE FOIS dans l'éditeur SQL du projet Supabase (Dashboard ->
-- SQL Editor -> New query -> coller ce fichier -> Run). Idempotent : peut
-- être rejoué sans erreur si déjà appliqué (create/drop if [not] exists).
--
-- Voir docs/CLOUD_ARCHITECTURE.md pour le contexte complet (pourquoi ce
-- modèle, ce qui reste source de vérité où, comment tester l'isolation
-- multi-utilisateur).

-- ---------------------------------------------------------------------------
-- 1) Table des métadonnées d'activité.
--
-- Le fichier original (GPX/FIT) reste la SOURCE DE VÉRITÉ de l'activité ; il
-- vit dans Storage (section 4 plus bas), jamais dupliqué ici. Cette table ne
-- contient QUE les métadonnées légères nécessaires pour lister/trier les
-- sorties sans télécharger chaque fichier (voir consigne §5, §25) — jamais
-- les échantillons (`samples`) ni aucune donnée dérivée (profil, archétype,
-- progression, Tour...), qui restent recalculées côté client à partir du
-- fichier original (voir consigne §18 et src/lib/cloud/README.md).
-- ---------------------------------------------------------------------------
create table if not exists public.activities (
  id uuid primary key default gen_random_uuid(),

  -- `default auth.uid()` : le frontend n'a jamais besoin d'envoyer user_id,
  -- et même s'il le faisait avec une valeur arbitraire, le WITH CHECK de la
  -- policy d'insertion (section 3) la rejetterait. L'ID utilisateur fourni
  -- par le frontend n'est JAMAIS une preuve d'autorisation (consigne §7) —
  -- seul le JWT vérifié par Supabase (auth.uid()) compte.
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,

  -- Provenance. `source_type` documente COMMENT l'activité est entrée dans le
  -- cloud (aujourd'hui : un seul chemin, l'upload manuel d'une sortie locale
  -- déjà GPX/FIT depuis DataSourcesView — voir consigne §15) ; une valeur
  -- comme 'strava' pourrait être ajoutée dans une phase future si Strava
  -- synchronise un jour directement vers le cloud sans passer par le local.
  -- `local_id` (l'id local d'origine, src/lib/types.js: generateId()) est
  -- purement informationnel : il n'est JAMAIS utilisé pour la déduplication
  -- (voir file_hash ci-dessous et consigne §17 : pas de correspondance
  -- approximative par id/date/distance).
  local_id text,
  source_type text not null check (source_type in ('local_upload')),
  source_file_name text,
  source_format text not null check (source_format in ('gpx', 'fit')),

  -- Empreinte SHA-256 (hex, 64 caractères) du contenu brut du fichier
  -- original — seule base de déduplication (voir src/lib/cloud/sync.js et
  -- la contrainte UNIQUE plus bas). Calculée côté client avant l'upload.
  file_hash text not null check (char_length(file_hash) = 64),

  -- Métadonnées légères (voir consigne §5 pour la liste). Toutes nullable :
  -- une valeur absente du fichier source reste NULL, jamais inventée (même
  -- règle que src/lib/types.js côté local).
  started_at timestamptz,
  distance double precision,
  duration double precision,
  moving_time double precision,
  elevation_gain double precision,
  elevation_loss double precision,
  avg_speed double precision,
  avg_power double precision,
  avg_cadence double precision,
  flags jsonb,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- Déduplication : le même fichier (même hash) ne peut pas être enregistré
  -- deux fois pour le même utilisateur. Deux sorties DIFFÉRENTES mais aux
  -- date/distance similaires restent toutes les deux acceptées (hash différent).
  unique (user_id, file_hash)
);

create index if not exists activities_user_id_started_at_idx
  on public.activities (user_id, started_at desc);

-- updated_at tenu à jour automatiquement à chaque modification.
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists activities_set_updated_at on public.activities;
create trigger activities_set_updated_at
  before update on public.activities
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- 2) Row Level Security — activée, sans exception. Sans policy, RLS bloque
--    tout accès par défaut ; les policies ci-dessous n'ouvrent que "ses
--    propres lignes", jamais plus.
-- ---------------------------------------------------------------------------
alter table public.activities enable row level security;

drop policy if exists "select own activities" on public.activities;
create policy "select own activities" on public.activities
  for select
  using (auth.uid() = user_id);

drop policy if exists "insert own activities" on public.activities;
create policy "insert own activities" on public.activities
  for insert
  with check (auth.uid() = user_id);

drop policy if exists "update own activities" on public.activities;
create policy "update own activities" on public.activities
  for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "delete own activities" on public.activities;
create policy "delete own activities" on public.activities
  for delete
  using (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- 3) Storage — bucket privé pour les fichiers originaux (FIT/GPX).
--
-- Chemin de chaque fichier : "<user_id>/<activity_id>.<ext>" — le PREMIER
-- segment du chemin est l'id utilisateur, ce qui permet aux policies
-- ci-dessous de le comparer directement à auth.uid(). C'est l'équivalent
-- fonctionnel de la structure conceptuelle "storage/users/<user-id>/
-- activities/<activity-id>.<ext>" évoquée dans la consigne : le segment
-- "users/" n'a pas besoin d'exister littéralement puisque le bucket entier
-- est déjà dédié aux fichiers d'activité.
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('activity-files', 'activity-files', false)
on conflict (id) do nothing;

drop policy if exists "select own activity files" on storage.objects;
create policy "select own activity files" on storage.objects
  for select
  using (
    bucket_id = 'activity-files'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "insert own activity files" on storage.objects;
create policy "insert own activity files" on storage.objects
  for insert
  with check (
    bucket_id = 'activity-files'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "delete own activity files" on storage.objects;
create policy "delete own activity files" on storage.objects
  for delete
  using (
    bucket_id = 'activity-files'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- Pas de policy UPDATE sur storage.objects : un fichier d'activité n'est
-- jamais modifié en place une fois uploadé (voir src/lib/cloud/files.js),
-- seulement créé ou supprimé.

-- ---------------------------------------------------------------------------
-- Phase 11B — ajout additif : nom de l'activité (voir ../types.js: Activity.name),
-- absent du schéma 11A. Nécessaire pour l'historique unifié (local + cloud),
-- qui doit pouvoir afficher un nom pour une sortie cloud-only sans encore
-- avoir téléchargé son fichier original. `add column if not exists` :
-- rejouable sans erreur sur une base où 11A a déjà été appliqué. Aucun impact
-- sur les policies RLS existantes (une policy s'applique à la ligne entière,
-- pas à une colonne précise) : aucune modification de sécurité ici.
-- ---------------------------------------------------------------------------
alter table public.activities add column if not exists name text;

-- ---------------------------------------------------------------------------
-- 4) Vérification manuelle de l'isolation multi-utilisateur (voir consigne
--    §20 : ceci ne peut PAS être vérifié par les tests unitaires locaux, qui
--    tournent contre un client Supabase simulé, pas une vraie base Postgres).
--
-- Depuis le SQL Editor, connecté en tant que service_role (donc SANS RLS) :
--   select id, user_id, source_file_name from public.activities order by created_at desc limit 20;
-- pour repérer deux id d'utilisateurs distincts (user A, user B).
--
-- Puis, dans l'application (deux comptes réels, ou deux onglets/navigateurs) :
--   1. Connecté comme user A : la liste de synchro doit montrer UNIQUEMENT
--      les activités de A (jamais celles de B), même si B en a.
--   2. Connecté comme user A, tenter de charger l'id d'une activité connue
--      de B (ex. via l'API REST Supabase directement, ou la console
--      navigateur : supabase.from('activities').select().eq('id', '<id de B>'))
--      doit renvoyer un tableau VIDE, jamais une erreur "forbidden" explicite
--      (RLS masque l'existence de la ligne plutôt que de révéler un refus) et
--      jamais les données de B.
--   3. Même vérification pour un fichier Storage de B : télécharger son
--      chemin exact depuis le compte de A doit échouer.
-- Documenter le résultat de ce test manuel avant de considérer le cloud prêt
-- pour un usage réel avec plusieurs comptes.

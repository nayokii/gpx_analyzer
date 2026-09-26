# Analyse de sortie vélo GPX — projet local

Application complète : import GPX, statistiques, carte Leaflet + OpenStreetMap
(vraies tuiles avec rues, routes, villes/villages), profil d'altitude/pente/
vitesse/FC/cadence/puissance **synchronisé avec la carte** (survol dans un sens
ou dans l'autre), détection des montées, splits, effort, zones FC, etc.

## Lancer le projet sur Windows

### 1. Installer Node.js (une seule fois)

Si tu ne l'as pas déjà : va sur https://nodejs.org, télécharge la version
"LTS" pour Windows, installe-la (Suivant → Suivant → Installer, valeurs par
défaut). Redémarre ton PC si on te le demande.

Pour vérifier que c'est installé, ouvre **PowerShell** (touche Windows, tape
"PowerShell", Entrée) et tape :

```
node -v
```

Si un numéro de version s'affiche (ex: v20.11.0), c'est bon.

### 2. Ouvrir le projet

Dézippe ce dossier où tu veux (ex: `Documents\gpx-analyzer-local`).

Dans PowerShell, déplace-toi dans le dossier (adapte le chemin) :

```
cd Documents\gpx-analyzer-local
```

### 3. Installer les dépendances (une seule fois)

```
npm install
```

Ça télécharge React, Leaflet, Recharts, etc. Ça prend une minute.

### 4. Lancer l'application

```
npm run dev
```

Le terminal affiche une adresse du type `http://localhost:5173/` — ouvre-la
dans ton navigateur (Chrome, Edge...). L'application se lance, avec la vraie
carte OpenStreetMap fonctionnelle.

Pour l'arrêter : `Ctrl + C` dans le terminal.

Pour la relancer plus tard, il suffit de refaire l'étape 4 (`npm run dev`) —
pas besoin de refaire `npm install` sauf si tu supprimes le dossier
`node_modules`.

### Alternative sans ligne de commande : VS Code + Live Server

Si tu préfères éviter le terminal pour le lancement quotidien, tu peux aussi
ouvrir le dossier dans **VS Code**, installer l'extension **Live Server**, et
cliquer "Go Live" — mais dans ce projet (React + Vite), `npm run dev` reste la
méthode recommandée : Live Server ne sait pas compiler le JSX.

## Structure du projet

```
gpx-analyzer-local/
├── index.html          point d'entrée HTML
├── package.json         dépendances et scripts
├── vite.config.js        configuration du bundler
├── src/
│   ├── main.jsx          démarrage de l'application React
│   └── GPXAnalyzer.jsx   toute l'application (parsing GPX, calculs, UI)
└── LISEZ-MOI.md         ce fichier
```

## Pourquoi la carte s'affiche ici mais pas dans l'aperçu Claude.ai ?

Dans l'artefact Claude.ai, les requêtes réseau vers les serveurs de tuiles
cartographiques (OpenStreetMap, CARTO...) sont bloquées par la sandbox de
l'interface — c'est une restriction de la plateforme, pas un bug du code.
Ici, en local dans ton propre navigateur, ces requêtes passent normalement :
tu obtiens donc les vraies tuiles avec rues, routes, villes et villages.

## Connecter Strava (optionnel)

L'app peut aussi importer tes sorties automatiquement depuis Strava (en plus
de l'import manuel GPX/FIT), depuis l'écran "Sources de données"
(accessible depuis l'accueil ou l'onglet Paramètres d'une sortie). Ça demande
une petite configuration côté développeur (clé d'API Strava) — voir
[docs/STRAVA_INTEGRATION.md](docs/STRAVA_INTEGRATION.md) pour le détail
complet.

## Synchroniser dans le cloud (optionnel)

L'app peut aussi synchroniser tes sorties vers le cloud (Supabase) pour les
retrouver depuis un autre appareil (ex. ton téléphone), depuis le même écran
"Sources de données" que Strava. Ça demande une petite configuration côté
développeur (créer un projet Supabase gratuit, exécuter `supabase/schema.sql`)
— voir [docs/CLOUD_ARCHITECTURE.md](docs/CLOUD_ARCHITECTURE.md) pour le détail
complet. Pour l'instant (Phase 11A), une sortie synchronisée reste dans le
cloud : elle n'apparaît pas encore dans Profil/Alter Ego/Archétype/Tour sur
l'appareil qui la retrouve — c'est prévu pour une phase suivante.

## Build de production (optionnel)

Si un jour tu veux un dossier statique déployable (ex: sur un hébergement
web) :

```
npm run build
```

Le résultat est généré dans le dossier `dist/`.

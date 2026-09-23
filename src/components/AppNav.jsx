/**
 * Navigation principale PERSISTANTE de l'application — distincte du contexte
 * d'une sortie ouverte (voir GPXAnalyzer.jsx : la bande contextuelle
 * "Sorties / Analyse — {nom}" ne s'affiche qu'en mode "dashboard", séparée
 * de cette nav globale).
 *
 * Un seul jeu d'items est rendu deux fois (desktop : barre horizontale dans
 * le bandeau supérieur ; mobile ≤680px : barre fixe en bas d'écran) plutôt
 * que deux composants différents, pour ne jamais faire diverger les 6
 * destinations entre les deux tailles d'écran. Le bouton "Importer" reste
 * dans le bandeau supérieur uniquement : à 6 items déjà présents, l'ajouter
 * à la barre basse la rendrait illisible sur mobile (voir consigne §9).
 *
 * "tour" (Phase 10B) : destination vers le Tour Simulator (voir
 * TourView.jsx), un raccourci d'expérience au-dessus du moteur pur de
 * src/lib/simulator/ (Phase 10A) — jamais une nouvelle source de vérité.
 */
import { Home, History as HistoryIcon, UserRound, Trophy, Fingerprint, Flag, Upload } from "lucide-react";

export const NAV_ITEMS = [
  { key: "home", label: "Accueil", icon: Home },
  { key: "rides", label: "Sorties", icon: HistoryIcon },
  { key: "profil", label: "Profil", icon: UserRound },
  { key: "alterego", label: "Alter Ego", icon: Trophy },
  { key: "archetype", label: "Archétype", icon: Fingerprint },
  { key: "tour", label: "Tour", icon: Flag },
];

/**
 * @param {Object} props
 * @param {string} props.active - clé de section active (voir NAV_ITEMS)
 * @param {Function} props.onNavigate - (key: string) => void
 * @param {Function} props.onImport - déclenche le sélecteur de fichier (toujours accessible, quelle que soit la section)
 */
export function AppNav({ active, onNavigate, onImport }) {
  const items = NAV_ITEMS.map(({ key, label, icon: Icon }) => (
    <button
      key={key}
      className={"gpx-appnav-item" + (active === key ? " active" : "")}
      onClick={() => onNavigate(key)}
      aria-current={active === key ? "page" : undefined}
      title={label}
    >
      <Icon size={17} />
      <span>{label}</span>
    </button>
  ));

  return (
    <>
      <div className="gpx-topbar">
        <button className="gpx-topbar-brand" onClick={() => onNavigate("home")} title="Accueil">
          <span className="gpx-topbar-brand-dot" />
          <span className="gpx-topbar-brand-text">GPX Analyzer</span>
        </button>
        <nav className="gpx-appnav gpx-appnav-top" aria-label="Navigation principale">{items}</nav>
        <button className="gpx-btn-primary gpx-appnav-import" onClick={onImport}>
          <Upload size={14} /> Importer
        </button>
      </div>
      <nav className="gpx-appnav gpx-appnav-bottom" aria-label="Navigation principale">{items}</nav>
    </>
  );
}

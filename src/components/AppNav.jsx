/**
 * Navigation principale PERSISTANTE de l'application — distincte du contexte
 * d'une sortie ouverte (voir GPXAnalyzer.jsx : la bande contextuelle
 * "Sorties / Analyse — {nom}" ne s'affiche qu'en mode "dashboard", séparée
 * de cette nav globale).
 *
 * Un seul jeu d'items est rendu deux fois (desktop : barre horizontale dans
 * le bandeau supérieur ; mobile ≤680px : barre fixe en bas d'écran) plutôt
 * que deux composants différents, pour ne jamais faire diverger les 7
 * destinations entre les deux tailles d'écran. Le bouton "Importer" reste
 * dans le bandeau supérieur uniquement : à autant d'items déjà présents,
 * l'ajouter à la barre basse la rendrait illisible sur mobile (voir consigne §9).
 *
 * "tour" (Phase 10B) : destination vers le Tour Simulator (voir
 * TourView.jsx), un raccourci d'expérience au-dessus du moteur pur de
 * src/lib/simulator/ (Phase 10A) — jamais une nouvelle source de vérité.
 * "coach" (Phase Coach V3A) : destination vers CoachView.jsx, une couche de
 * lecture au-dessus de src/lib/coach/ (jamais un second calcul).
 */
import { Home, History as HistoryIcon, UserRound, Trophy, Fingerprint, Flag, NotebookText, Upload } from "lucide-react";
import { ActiveIndicator, useActiveIndicator } from "./ActiveIndicator.jsx";

export const NAV_ITEMS = [
  { key: "home", label: "Accueil", icon: Home },
  { key: "rides", label: "Sorties", icon: HistoryIcon },
  { key: "coach", label: "Coach", icon: NotebookText },
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

  // Un indicateur par barre (haute et basse) : règle d'état actif unique, voir ActiveIndicator.jsx.
  const top = useActiveIndicator(active);
  const bottom = useActiveIndicator(active);

  return (
    <>
      <div className="gpx-topbar">
        <button className="gpx-topbar-brand" onClick={() => onNavigate("home")} title="Accueil">
          <span className="gpx-topbar-brand-dot" />
          <span className="gpx-topbar-brand-text">Cycling OS</span>
        </button>
        <nav ref={top.ref} className="gpx-appnav gpx-appnav-top gpx-has-indicator" aria-label="Navigation principale">
          {items}
          <ActiveIndicator style={top.style} ready={top.ready} />
        </nav>
        <button className="gpx-btn-primary gpx-appnav-import" onClick={onImport}>
          <Upload size={14} /> Importer
        </button>
      </div>
      <nav ref={bottom.ref} className="gpx-appnav gpx-appnav-bottom gpx-has-indicator" aria-label="Navigation principale">
        {items}
        <ActiveIndicator style={bottom.style} ready={bottom.ready} />
      </nav>
    </>
  );
}

/**
 * Navigation principale PERSISTANTE de l'application : destinations, barre latérale (desktop / rail tablette) et barre
 * basse (mobile). Rendue par AppShell.jsx — un seul jeu de destinations (NAV_GROUPS), jamais deux listes qui divergent.
 *
 * Les clés sont celles du routage existant de GPXAnalyzer.jsx (`mode`) : `onNavigate(key)` reçoit exactement les mêmes
 * valeurs qu'avant. « rides » ouvre l'historique (mode "historique") ; le détail d'une sortie (mode "dashboard") garde
 * « rides » actif — c'est le fil d'Ariane du shell qui porte le contexte « sortie ouverte ».
 *
 * Aucune destination sans route réelle : « Sources de données » ouvre le mode `sources` existant ; Carte, Objectifs et
 * Records n'ont pas de page propre (ils vivent dans le détail d'une sortie, Alter Ego et le Dashboard).
 */
import { useEffect, useRef, useState } from "react";
import {
  History as HistoryIcon, UserRound, Trophy, Fingerprint, Flag, NotebookText, Newspaper, LayoutDashboard, Database, Ellipsis,
} from "lucide-react";

export const NAV_GROUPS = [
  {
    key: "pilotage", label: "Pilotage",
    items: [
      { key: "home", label: "Dashboard", short: "Dashboard", icon: LayoutDashboard },
      { key: "rides", label: "Mes sorties", short: "Sorties", icon: HistoryIcon },
      { key: "feed", label: "Activités", short: "Activités", icon: Newspaper },
    ],
  },
  {
    key: "analyses", label: "Analyses",
    items: [
      { key: "coach", label: "Coach", short: "Coach", icon: NotebookText },
      { key: "profil", label: "Profil", short: "Profil", icon: UserRound },
      { key: "archetype", label: "Archétype", short: "Archétype", icon: Fingerprint },
      { key: "tour", label: "Tour", short: "Tour", icon: Flag },
    ],
  },
  { key: "progression", label: "Progression", items: [{ key: "alterego", label: "Alter Ego", short: "Alter Ego", icon: Trophy }] },
  { key: "systeme", label: "Système", items: [{ key: "sources", label: "Sources de données", short: "Sources", icon: Database }] },
];

/** Les 8 destinations de contenu (hors « Sources de données », qui relève du système). */
export const NAV_ITEMS = NAV_GROUPS.flatMap((g) => g.items).filter((i) => i.key !== "sources");

const ALL_ITEMS = NAV_GROUPS.flatMap((g) => g.items);
/** Destinations prioritaires de la barre basse mobile ; les autres sont dans le menu « Plus ». */
export const MOBILE_PRIMARY_KEYS = ["home", "rides", "feed", "alterego"];

export function findNavItem(key) {
  return ALL_ITEMS.find((i) => i.key === key) || null;
}
export function findNavGroup(key) {
  return NAV_GROUPS.find((g) => g.items.some((i) => i.key === key)) || null;
}

/** Barre latérale : groupes logiques sur desktop, rail d'icônes sur tablette (libellés conservés pour les lecteurs d'écran). */
export function SidebarNav({ active, onNavigate }) {
  return (
    <aside className="gpx-sidebar">
      <button type="button" className="gpx-sidebar-brand" onClick={() => onNavigate("home")} title="Dashboard" aria-label="Cycling OS — Dashboard">
        <span className="gpx-brand-dot" aria-hidden="true" />
        <span className="gpx-sidebar-label">Cycling OS</span>
      </button>
      <nav className="gpx-sidebar-nav" aria-label="Navigation principale">
        {NAV_GROUPS.map((group) => (
          <div className="gpx-sidebar-group" role="group" aria-label={group.label} key={group.key}>
            <p className="gpx-sidebar-heading" aria-hidden="true">{group.label}</p>
            {group.items.map(({ key, label, icon: Icon }) => (
              <button
                key={key}
                type="button"
                className={"gpx-sidebar-item" + (active === key ? " active" : "")}
                onClick={() => onNavigate(key)}
                aria-current={active === key ? "page" : undefined}
                aria-label={label}
                title={label}
              >
                <Icon size={18} aria-hidden="true" />
                <span className="gpx-sidebar-label">{label}</span>
              </button>
            ))}
          </div>
        ))}
      </nav>
    </aside>
  );
}

/** Barre basse mobile : 4 destinations prioritaires + « Plus » (menu des autres destinations, y compris les sources). */
export function BottomNav({ active, onNavigate }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);
  const primary = MOBILE_PRIMARY_KEYS.map(findNavItem);
  const secondary = ALL_ITEMS.filter((i) => !MOBILE_PRIMARY_KEYS.includes(i.key));
  const moreActive = secondary.some((i) => i.key === active);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => { if (e.key === "Escape") setOpen(false); };
    const onPointer = (e) => { if (rootRef.current && !rootRef.current.contains(e.target)) setOpen(false); };
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onPointer);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onPointer);
    };
  }, [open]);

  function go(key) {
    setOpen(false);
    onNavigate(key);
  }

  return (
    <div className="gpx-bottomnav-wrap" ref={rootRef}>
      {open && (
        <div className="gpx-more-menu" id="gpx-more-menu" role="group" aria-label="Autres destinations">
          {secondary.map(({ key, label, icon: Icon }) => (
            <button
              key={key} type="button"
              className={"gpx-more-item" + (active === key ? " active" : "")}
              aria-current={active === key ? "page" : undefined}
              onClick={() => go(key)}
            >
              <Icon size={18} aria-hidden="true" />
              <span>{label}</span>
            </button>
          ))}
        </div>
      )}
      <nav className="gpx-bottomnav" aria-label="Navigation principale (mobile)">
        {primary.map(({ key, short, label, icon: Icon }) => (
          <button
            key={key} type="button"
            className={"gpx-bottomnav-item" + (active === key ? " active" : "")}
            aria-current={active === key ? "page" : undefined}
            aria-label={label}
            onClick={() => go(key)}
          >
            <Icon size={22} aria-hidden="true" />
            <span>{short}</span>
          </button>
        ))}
        <button
          type="button"
          className={"gpx-bottomnav-item" + (moreActive ? " active" : "") + (open ? " is-open" : "")}
          aria-expanded={open}
          aria-controls="gpx-more-menu"
          aria-label="Plus de destinations"
          onClick={() => setOpen((v) => !v)}
        >
          <Ellipsis size={22} aria-hidden="true" />
          <span>Plus</span>
        </button>
      </nav>
    </div>
  );
}

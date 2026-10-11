/**
 * Coque globale de Cycling OS : navigation (barre latérale / rail / barre basse), en-tête de page, thème, import et zone
 * de contenu. Toutes les vues sauf la récupération de mot de passe (flux d'authentification sans navigation) y sont rendues.
 *
 * S'intègre au routage existant — AUCUN second routeur : GPXAnalyzer.jsx garde son état `mode` et passe `active` +
 * `onNavigate`. L'en-tête porte le fil d'Ariane (« Pilotage › Mes sorties », ou « Mes sorties › Analyse — {sortie} » quand une
 * sortie est ouverte), les actions contextuelles éventuelles (`actions`), le sélecteur de thème et l'import : un seul
 * emplacement pour chacun, sur toutes les tailles d'écran.
 *
 * Les titres h1 restent ceux des pages (le fil d'Ariane est un repère de contexte, pas un second titre).
 */
import { ChevronRight, Upload } from "lucide-react";

import { SidebarNav, BottomNav, findNavItem, findNavGroup } from "./AppNav.jsx";
import { ThemeToggle } from "./ThemeToggle.jsx";

/**
 * Fil d'Ariane de la page active.
 * @returns {Array<{label: string, onClick?: Function}>} le dernier élément est la page courante
 */
export function buildCrumbs(active, rideContext, onNavigate) {
  const item = findNavItem(active);
  const group = findNavGroup(active);
  if (rideContext) {
    return [
      { label: item ? item.label : "Mes sorties", onClick: () => onNavigate(active) },
      { label: `Analyse — ${rideContext.name || "Sortie vélo"}` },
    ];
  }
  if (!item) return [];
  return group && group.items.length > 0 ? [{ label: group.label }, { label: item.label }] : [{ label: item.label }];
}

/**
 * @param {Object} props
 * @param {string} props.active - clé de la destination active (voir NAV_GROUPS)
 * @param {Function} props.onNavigate - (key) => void
 * @param {Function} props.onImport - ouvre le sélecteur de fichier (toujours accessible)
 * @param {{name: string}|null} [props.rideContext] - sortie ouverte (détail) : fil d'Ariane contextuel
 * @param {React.ReactNode} [props.actions] - actions contextuelles de la page, à gauche du thème
 */
export function AppShell({ active, onNavigate, onImport, rideContext = null, actions = null, children }) {
  const crumbs = buildCrumbs(active, rideContext, onNavigate);
  return (
    <div className="gpx-app gpx-shell">
      <a className="gpx-skip-link" href="#gpx-main">Aller au contenu</a>
      <SidebarNav active={active} onNavigate={onNavigate} />
      <div className="gpx-shell-main">
        <header className="gpx-shell-header">
          <button type="button" className="gpx-shell-brand" onClick={() => onNavigate("home")} aria-label="Cycling OS — Dashboard" title="Dashboard">
            <span className="gpx-brand-dot" aria-hidden="true" />
          </button>
          <nav className="gpx-shell-crumbs" aria-label="Fil d'Ariane">
            <ol>
              {crumbs.map((c, i) => {
                const last = i === crumbs.length - 1;
                return (
                  <li key={i} className={last ? "is-current" : undefined}>
                    {i > 0 && <ChevronRight size={13} aria-hidden="true" />}
                    {c.onClick && !last ? (
                      <button type="button" className="gpx-link-btn" onClick={c.onClick}>{c.label}</button>
                    ) : (
                      <span aria-current={last ? "page" : undefined}>{c.label}</span>
                    )}
                  </li>
                );
              })}
            </ol>
          </nav>
          <div className="gpx-shell-actions">
            {actions}
            <ThemeToggle />
            <button type="button" className="gpx-btn-primary gpx-shell-import" onClick={onImport} aria-label="Importer une sortie" title="Importer une sortie">
              <Upload size={16} aria-hidden="true" /> <span>Importer</span>
            </button>
          </div>
        </header>
        <main id="gpx-main" className="gpx-shell-content" tabIndex={-1}>
          {children}
        </main>
      </div>
      <BottomNav active={active} onNavigate={onNavigate} />
    </div>
  );
}

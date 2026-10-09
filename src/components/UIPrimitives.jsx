/**
 * Petits composants UI réutilisables (carte de statistique, titre de section,
 * tooltip de graphique).
 */

import { ArrowUp, ArrowDown } from "lucide-react";
import { COLORS } from "../lib/colors.js";
import { AnimatedValue } from "./AnimatedValue.jsx";
import { fmt1, fmtInt, fmtClock } from "../lib/utils.js";

export function StatCard({ icon: Icon, label, value, unit, accent = COLORS.speed, sub }) {
  if (value == null) return null;
  return (
    <div className="gpx-stat-card" style={{ "--stat-accent": accent }}>
      <div className="gpx-stat-label">
        {Icon && <Icon size={12} strokeWidth={2} />}
        <span>{label}</span>
      </div>
      <div className="gpx-stat-value">
        <AnimatedValue value={value} />
        {unit && <span className="gpx-stat-unit">{unit}</span>}
      </div>
      {sub && <div className="gpx-stat-sub">{sub}</div>}
    </div>
  );
}

/**
 * Groupe de métriques : une valeur héroïque (grande) suivie de lignes secondaires.
 * @param {Object} props
 * @param {string} props.title - libellé du groupe
 * @param {string} props.accent - couleur métier (ex. COLORS.speed)
 * @param {{value: string, unit?: string}} props.hero - valeur dominante, déjà formatée
 * @param {Array<{label: string, value: string, unit?: string}>} props.rows - lignes secondaires ; une valeur nulle est ignorée
 */
export function MetricGroup({ title, accent = COLORS.speed, hero, rows = [] }) {
  const visible = rows.filter((r) => r.value != null);
  const heroMissing = hero.value == null || hero.value === "—";
  return (
    <div className="gpx-metric-group" style={{ "--group-accent": accent }}>
      <div className="gpx-metric-group-head"><span className="gpx-metric-group-dot" />{title}</div>
      <div className="gpx-metric-hero">
        <span className="gpx-metric-hero-value">{heroMissing ? "—" : <AnimatedValue value={hero.value} />}</span>
        {hero.unit && !heroMissing && <span className="gpx-metric-hero-unit">{hero.unit}</span>}
      </div>
      {visible.length > 0 && (
        <dl className="gpx-metric-rows">
          {visible.map((r) => (
            <div className="gpx-metric-row" key={r.label}>
              <dt>{r.label}</dt>
              <dd>{r.value}{r.unit && r.value !== "—" && <small>{r.unit}</small>}</dd>
            </div>
          ))}
        </dl>
      )}
    </div>
  );
}

/**
 * Anneau de progression (présentation seule). `value` ∈ [0, 100] ; les enfants sont centrés dans l'anneau.
 * Aucune animation au premier rendu : la transition CSS ne joue que si la valeur change ensuite.
 */
export function ProgressRing({ value, size, stroke = 14, label, children, className }) {
  const pct = Math.max(0, Math.min(100, Number.isFinite(value) ? value : 0));
  // Géométrie fixe (viewBox 168) ; la taille affichée vient de --ring-size (CSS), surchargeable par `size`.
  const box = 168;
  const r = (box - stroke) / 2;
  const c = 2 * Math.PI * r;
  return (
    <div className={"gpx-ring" + (className ? " " + className : "")} style={size ? { "--ring-size": size + "px" } : undefined} role="img" aria-label={label}>
      <svg viewBox={`0 0 ${box} ${box}`} aria-hidden="true">
        <circle className="gpx-ring-track" cx={box / 2} cy={box / 2} r={r} fill="none" strokeWidth={stroke} />
        <circle
          className="gpx-ring-fill" cx={box / 2} cy={box / 2} r={r} fill="none" strokeWidth={stroke} strokeLinecap="round"
          strokeDasharray={c} strokeDashoffset={c * (1 - pct / 100)}
        />
      </svg>
      <div className="gpx-ring-center">{children}</div>
    </div>
  );
}

/**
 * En-tête de page (vues hors Analyse) : titre éditorial, méta discrète, actions à droite.
 * @param {Object} props
 * @param {string} [props.eyebrow] - petite ligne au-dessus du titre
 * @param {string} props.title
 * @param {React.ReactNode} [props.meta] - sous-titre
 * @param {React.ReactNode} [props.actions] - boutons alignés à droite
 */
export function PageHead({ eyebrow, title, meta, actions }) {
  return (
    <header className="gpx-page-head">
      <div className="gpx-page-head-main">
        {eyebrow && <p className="gpx-page-eyebrow">{eyebrow}</p>}
        <h1 className="gpx-page-title">{title}</h1>
        {meta && <p className="gpx-page-meta">{meta}</p>}
      </div>
      {actions && <div className="gpx-header-actions">{actions}</div>}
    </header>
  );
}

/**
 * Contrôle de tri compact (mobile) : critère + sens. Remplace les en-têtes de colonnes masqués sur petit écran
 * et pilote exactement le même état de tri que ces en-têtes (aucun second mécanisme).
 * @param {Object} props
 * @param {Array<[string, string]>} props.columns - [clé, libellé] des critères disponibles
 * @param {{key: string, dir: 1|-1}} props.sort
 * @param {Function} props.onSortKey - (key) => void : choisit un critère (sens croissant)
 * @param {Function} props.onToggleDir - () => void : inverse le sens
 * @param {string} props.label - libellé accessible (ex. « Trier les montées »)
 */
export function SortControl({ columns, sort, onSortKey, onToggleDir, label }) {
  const value = columns.some(([key]) => key === sort.key) ? sort.key : columns[0][0];
  return (
    <div className="gpx-sort-control" role="group" aria-label={label}>
      <label className="gpx-sort-control-field">
        <span>Trier par</span>
        <select value={value} onChange={(e) => onSortKey(e.target.value)}>
          {columns.map(([key, text]) => <option key={key} value={key}>{text}</option>)}
        </select>
      </label>
      <button
        type="button" className="gpx-icon-btn" onClick={onToggleDir}
        aria-label={sort.dir === 1 ? "Ordre croissant — inverser" : "Ordre décroissant — inverser"}
        title={sort.dir === 1 ? "Croissant" : "Décroissant"}
      >
        {sort.dir === 1 ? <ArrowUp size={16} /> : <ArrowDown size={16} />}
      </button>
    </div>
  );
}

export function SectionTitle({ icon: Icon, children, right }) {
  return (
    <div className="gpx-section-title">
      <div className="gpx-section-title-left">
        {Icon && <span className="gpx-section-icon" aria-hidden="true"><Icon size={16} strokeWidth={2.2} /></span>}
        <span>{children}</span>
      </div>
      {right}
    </div>
  );
}

export function CustomTooltip({ active, payload, hasHR, hasCad, hasPower }) {
  if (!active || !payload || !payload.length) return null;
  const d = payload[0].payload;
  return (
    <div className="gpx-tooltip">
      <div className="gpx-tooltip-row gpx-tooltip-main">{fmt1(d.distance)} km</div>
      {d.ele != null && <div className="gpx-tooltip-row"><span>Altitude</span><b>{fmtInt(d.ele)} m</b></div>}
      {d.speed != null && <div className="gpx-tooltip-row"><span>Vitesse</span><b>{fmt1(d.speed)} km/h</b></div>}
      {hasHR && d.hr != null && <div className="gpx-tooltip-row"><span>FC</span><b>{fmtInt(d.hr)} bpm</b></div>}
      {hasCad && d.cad != null && <div className="gpx-tooltip-row"><span>Cadence</span><b>{fmtInt(d.cad)} rpm</b></div>}
      {hasPower && d.power != null && <div className="gpx-tooltip-row"><span>Puissance</span><b>{fmtInt(d.power)} W</b></div>}
      {d.time && <div className="gpx-tooltip-row"><span>Heure</span><b>{fmtClock(d.time)}</b></div>}
    </div>
  );
}

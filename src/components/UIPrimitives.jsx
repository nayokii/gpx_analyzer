/**
 * Petits composants UI réutilisables (carte de statistique, titre de section,
 * tooltip de graphique).
 */

import { COLORS } from "../lib/colors.js";
import { fmt1, fmtInt, fmtClock } from "../lib/utils.js";

export function StatCard({ icon: Icon, label, value, unit, accent = COLORS.speed, sub }) {
  if (value == null) return null;
  return (
    <div className="gpx-stat-card">
      <div className="gpx-stat-icon" style={{ color: accent, background: accent + "1a" }}>
        <Icon size={16} strokeWidth={2.2} />
      </div>
      <div className="gpx-stat-body">
        <div className="gpx-stat-label">{label}</div>
        <div className="gpx-stat-value">
          {value}
          {unit && <span className="gpx-stat-unit">{unit}</span>}
        </div>
        {sub && <div className="gpx-stat-sub">{sub}</div>}
      </div>
    </div>
  );
}

export function SectionTitle({ icon: Icon, children, right }) {
  return (
    <div className="gpx-section-title">
      <div className="gpx-section-title-left">
        {Icon && <Icon size={15} strokeWidth={2.2} />}
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

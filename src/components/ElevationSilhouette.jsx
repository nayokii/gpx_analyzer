/**
 * Silhouette du relief : aire dessinée à partir des altitudes RÉELLES de la sortie (série décimée déjà
 * calculée), posée en fond de l'en-tête de l'Analyse. Purement visuelle (aria-hidden) ; sans altitude,
 * rien n'est rendu — aucune donnée n'est inventée.
 */
import { useMemo } from "react";

const W = 1000;
const H = 100;

export function ElevationSilhouette({ points }) {
  const path = useMemo(() => {
    const pts = (points || []).filter((p) => p && p.ele != null && p.distance != null);
    if (pts.length < 3) return null;
    let lo = Infinity;
    let hi = -Infinity;
    for (const p of pts) {
      if (p.ele < lo) lo = p.ele;
      if (p.ele > hi) hi = p.ele;
    }
    const d0 = pts[0].distance;
    const span = pts[pts.length - 1].distance - d0 || 1;
    const range = hi - lo || 1;
    // Sur un relief quasi plat, on évite d'étirer le bruit à pleine hauteur.
    const amp = Math.min(1, Math.max(0.18, range / 120));
    const line = pts.map((p, i) => {
      const x = ((p.distance - d0) / span) * W;
      const y = H - 6 - ((p.ele - lo) / range) * (H - 22) * amp;
      return `${i === 0 ? "M" : "L"}${x.toFixed(1)} ${y.toFixed(1)}`;
    });
    return { line: line.join(" "), area: `${line.join(" ")} L${W} ${H} L0 ${H} Z` };
  }, [points]);

  if (!path) return null;
  return (
    <div className="gpx-silhouette" aria-hidden="true">
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none">
        <defs>
          <linearGradient id="gpxSilhouetteFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--climb)" stopOpacity="0.28" />
            <stop offset="100%" stopColor="var(--climb)" stopOpacity="0.02" />
          </linearGradient>
        </defs>
        <path d={path.area} fill="url(#gpxSilhouetteFill)" />
        <path d={path.line} fill="none" stroke="var(--climb)" strokeOpacity="0.55" strokeWidth="1.6" vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
      </svg>
    </div>
  );
}

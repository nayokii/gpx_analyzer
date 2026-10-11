/**
 * PROFILE CHART — profil (altitude / pente / vitesse / FC / cadence / puissance)
 * synchronisé avec la carte dans les deux sens : survol/glisser ici déplace le
 * marqueur sur la carte, et survoler le tracé sur la carte déplace le curseur
 * ici. Rendu en <canvas> pour rester fluide même avec beaucoup de points.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { X } from "lucide-react";

import { COLORS } from "../lib/colors.js";
import { cssVar, resolveColor, useColorScheme } from "../lib/theme.js";
import { fmt1, fmtInt, fmtClock } from "../lib/utils.js";

function availableProfileMetrics(analysis) {
  const list = [];
  if (analysis.hasEle) list.push({ key: "altitude", label: "Altitude", dataKey: "ele" });
  if (analysis.hasEle) list.push({ key: "pente", label: "Pente", dataKey: "grade" });
  if (analysis.hasTime) list.push({ key: "vitesse", label: "Vitesse", dataKey: "speed" });
  if (analysis.hasHR) list.push({ key: "fc", label: "FC", dataKey: "hr" });
  if (analysis.hasCad) list.push({ key: "cadence", label: "Cadence", dataKey: "cad" });
  if (analysis.hasPower) list.push({ key: "puissance", label: "Puissance", dataKey: "power" });
  return list;
}
/** "#rrggbb" + alpha → rgba() : le canvas ne comprend ni var() ni color-mix(). */
function withAlpha(color, a) {
  const m = /^#([\da-f]{6})$/i.exec(color || "");
  if (!m) return color;
  const n = parseInt(m[1], 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}
function fmtAxisVal(metric, v) {
  if (v == null || isNaN(v)) return "—";
  if (metric === "altitude") return fmtInt(v) + " m";
  if (metric === "pente") return fmt1(v) + " %";
  if (metric === "vitesse") return fmt1(v) + " km/h";
  if (metric === "fc") return fmtInt(v) + " bpm";
  if (metric === "cadence") return fmtInt(v) + " rpm";
  if (metric === "puissance") return fmtInt(v) + " W";
  return fmt1(v);
}

/**
 * @param {Object} props
 * @param {boolean} [props.showMetricTabs=true] - false : métrique figée (panneau dédié, ex. profil d'altitude)
 * @param {string[]|null} [props.allowedMetrics=null] - restreint les métriques proposées (clés de availableProfileMetrics)
 * @param {"minimal"|"full"} [props.axes="minimal"] - "full" : graduations sur les deux axes + unité en titre
 * @param {string} [props.label] - description accessible du graphique
 * @param {string} [props.powerLabel="Puissance"] - libellé de la ligne puissance de l'infobulle (ex. « Puissance (estimée) »)
 */
export function ProfileChart({
  analysis, decimated, metric, setMetric, hoverIdx, setHoverIdx, selectedClimb, onSelectClimb, height = 200,
  showMetricTabs = true, allowedMetrics = null, axes = "minimal", label, powerLabel = "Puissance",
}) {
  const canvasRef = useRef(null);
  const wrapRef = useRef(null);
  const [width, setWidth] = useState(800);
  const scheme = useColorScheme(); // le canvas ne suit pas le CSS : on le redessine quand le thème change
  const metrics = useMemo(() => {
    const all = availableProfileMetrics(analysis);
    return allowedMetrics ? all.filter((m) => allowedMetrics.includes(m.key)) : all;
  }, [analysis, allowedMetrics]);
  const activeMetric = metrics.find((m) => m.key === metric) || metrics[0];

  useEffect(() => {
    function onResize() {
      if (wrapRef.current) setWidth(wrapRef.current.clientWidth);
    }
    onResize();
    window.addEventListener("resize", onResize);
    // La grille du cockpit peut changer la largeur du panneau sans resize de fenêtre.
    const observer = typeof ResizeObserver !== "undefined" && wrapRef.current ? new ResizeObserver(onResize) : null;
    if (observer) observer.observe(wrapRef.current);
    return () => {
      window.removeEventListener("resize", onResize);
      if (observer) observer.disconnect();
    };
  }, []);

  const dataKey = activeMetric ? activeMetric.dataKey : "ele";
  const values = decimated.map((p) => p[dataKey]).filter((v) => v != null);
  const minV = values.length ? Math.min(...values) : 0;
  const maxV = values.length ? Math.max(...values) : 1;
  const distMin = decimated[0] ? decimated[0].distance : 0;
  const distMax = decimated[decimated.length - 1] ? decimated[decimated.length - 1].distance : 1;

  const full = axes === "full";
  const padL = full ? 58 : 44,
    padR = 12,
    padT = 14,
    padB = full ? 30 : 22;
  function xForDist(d) {
    return padL + ((d - distMin) / (distMax - distMin || 1)) * (width - padL - padR);
  }
  function yForVal(v) {
    const h = height - padT - padB;
    return padT + h - ((v - minV) / (maxV - minV || 1)) * h;
  }
  function distForX(x) {
    return distMin + ((x - padL) / (width - padL - padR || 1)) * (distMax - distMin);
  }

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !activeMetric) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    canvas.style.width = width + "px";
    canvas.style.height = height + "px";
    const ctx = canvas.getContext("2d");
    if (!ctx) return; // environnement sans canvas (tests jsdom, navigateur très restreint)
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, width, height);

    const climbColor = resolveColor(COLORS.climb);
    const gridColor = resolveColor("var(--separator)");
    const mutedColor = resolveColor(COLORS.textMuted);
    const textColor = resolveColor(COLORS.text);
    const surfaceColor = resolveColor(COLORS.surface);
    const fontFamily = cssVar("--font-sans", "sans-serif");

    (analysis.climbs || []).forEach((c) => {
      const x1 = xForDist(c.startDistance),
        x2 = xForDist(c.endDistance);
      ctx.fillStyle = withAlpha(climbColor, selectedClimb && selectedClimb.id === c.id ? 0.24 : 0.09);
      ctx.fillRect(x1, padT, x2 - x1, height - padT - padB);
    });

    ctx.strokeStyle = gridColor;
    ctx.lineWidth = 1;
    for (let i = 0; i <= 4; i++) {
      const y = padT + (i / 4) * (height - padT - padB);
      ctx.beginPath();
      ctx.moveTo(padL, y);
      ctx.lineTo(width - padR, y);
      ctx.stroke();
    }

    const accentMap = { altitude: COLORS.climb, pente: COLORS.climb, vitesse: COLORS.speed, fc: COLORS.effort, cadence: COLORS.info, puissance: COLORS.info };
    const stroke = resolveColor(accentMap[activeMetric.key] || COLORS.speed);
    ctx.beginPath();
    let started = false;
    decimated.forEach((p) => {
      const v = p[dataKey];
      if (v == null) {
        started = false;
        return;
      }
      const x = xForDist(p.distance),
        y = yForVal(v);
      if (!started) {
        ctx.moveTo(x, y);
        started = true;
      } else ctx.lineTo(x, y);
    });
    ctx.strokeStyle = stroke;
    ctx.lineWidth = 2.5;
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    ctx.stroke();
    ctx.lineTo(xForDist(distMax), yForVal(minV));
    ctx.lineTo(xForDist(distMin), yForVal(minV));
    ctx.closePath();
    const fillGrad = typeof ctx.createLinearGradient === "function" ? ctx.createLinearGradient(0, padT, 0, height - padB) : null;
    if (fillGrad) {
      fillGrad.addColorStop(0, withAlpha(stroke, 0.3));
      fillGrad.addColorStop(1, withAlpha(stroke, 0.02));
    }
    ctx.fillStyle = fillGrad || withAlpha(stroke, 0.12);
    ctx.fill();

    ctx.fillStyle = mutedColor;
    ctx.font = `500 11.5px ${fontFamily}`;
    if (full) {
      // Graduations : 5 repères verticaux alignés sur la grille, ~5 repères en distance.
      ctx.textAlign = "right";
      for (let i = 0; i <= 4; i++) {
        const v = maxV - (i / 4) * (maxV - minV);
        const y = padT + (i / 4) * (height - padT - padB);
        ctx.fillText(fmtAxisVal(activeMetric.key, v), padL - 6, y + 4);
      }
      ctx.textAlign = "center";
      const ticks = 5;
      for (let i = 0; i <= ticks; i++) {
        const d = distMin + (i / ticks) * (distMax - distMin);
        ctx.textAlign = i === 0 ? "left" : i === ticks ? "right" : "center";
        ctx.fillText(fmt1(d) + (i === ticks ? " km" : ""), xForDist(d), height - 8);
      }
    } else {
      ctx.textAlign = "left";
      ctx.fillText(fmtAxisVal(activeMetric.key, maxV), 2, padT + 8);
      ctx.fillText(fmtAxisVal(activeMetric.key, minV), 2, height - padB);
      ctx.fillText(fmt1(distMin) + " km", padL + 2, height - 6);
      ctx.textAlign = "right";
      ctx.fillText(fmt1(distMax) + " km", width - padR, height - 6);
    }

    if (hoverIdx != null && decimated[hoverIdx]) {
      const p = decimated[hoverIdx];
      const x = xForDist(p.distance);
      ctx.beginPath();
      ctx.moveTo(x, padT);
      ctx.lineTo(x, height - padB);
      ctx.strokeStyle = withAlpha(textColor, 0.35);
      ctx.lineWidth = 1;
      ctx.stroke();
      const v = p[dataKey];
      if (v != null) {
        const y = yForVal(v);
        ctx.beginPath();
        ctx.arc(x, y, 5, 0, Math.PI * 2);
        ctx.fillStyle = stroke;
        ctx.fill();
        ctx.strokeStyle = surfaceColor;
        ctx.lineWidth = 2.5;
        ctx.stroke();
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [width, height, decimated, activeMetric && activeMetric.key, hoverIdx, selectedClimb, analysis, scheme, full]);

  function idxFromClientX(clientX) {
    const rect = canvasRef.current.getBoundingClientRect();
    const d = distForX(clientX - rect.left);
    let lo = 0,
      hi = decimated.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (decimated[mid].distance < d) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  }
  function handleMove(clientX) {
    setHoverIdx(idxFromClientX(clientX));
  }
  // Clavier : ←/→ déplacent le repère (±1 point, ±10 avec Maj), Début/Fin vont aux extrémités, Échap l'enlève.
  function handleKeyDown(e) {
    const last = decimated.length - 1;
    if (last < 0) return;
    const step = e.shiftKey ? 10 : 1;
    const cur = hoverIdx == null ? null : hoverIdx;
    let next = null;
    if (e.key === "ArrowRight") next = Math.min(last, (cur == null ? -1 : cur) + step);
    else if (e.key === "ArrowLeft") next = Math.max(0, (cur == null ? last + 1 : cur) - step);
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = last;
    else if (e.key === "Escape") { setHoverIdx(null); return; }
    else return;
    e.preventDefault();
    setHoverIdx(next);
  }
  function handleClick(clientX) {
    const idx = idxFromClientX(clientX);
    const p = decimated[idx];
    const c = (analysis.climbs || []).find((cl) => p.distance >= cl.startDistance && p.distance <= cl.endDistance);
    if (c) onSelectClimb(selectedClimb && selectedClimb.id === c.id ? null : c);
  }

  const hoverPoint = hoverIdx != null ? decimated[hoverIdx] : null;
  if (!activeMetric) return null;

  return (
    <div ref={wrapRef} className="gpx-profile-wrap">
      {showMetricTabs && (
        <div className="gpx-map-modes" style={{ marginBottom: 14 }}>
          {metrics.map((m) => (
            <button
              key={m.key}
              className={"gpx-chip" + (activeMetric.key === m.key ? " gpx-chip-active" : "")}
              aria-pressed={activeMetric.key === m.key}
              onClick={() => setMetric(m.key)}
            >
              {m.label}
            </button>
          ))}
        </div>
      )}
      <div style={{ position: "relative" }}>
        <canvas
          ref={canvasRef}
          role="img"
          tabIndex={0}
          aria-label={label || `Profil ${activeMetric.label.toLowerCase()} en fonction de la distance. Flèches gauche et droite pour déplacer le repère.`}
          onKeyDown={handleKeyDown}
          onMouseMove={(e) => handleMove(e.clientX)}
          onMouseLeave={() => setHoverIdx(null)}
          onClick={(e) => handleClick(e.clientX)}
          onTouchStart={(e) => handleMove(e.touches[0].clientX)}
          onTouchMove={(e) => {
            e.preventDefault();
            handleMove(e.touches[0].clientX);
          }}
          style={{ display: "block", cursor: "crosshair", touchAction: "none" }}
        />
        {hoverPoint && (
          <div className="gpx-tooltip" style={{ position: "absolute", top: 6, left: Math.min(width - 175, Math.max(0, xForDist(hoverPoint.distance) + 10)), pointerEvents: "none" }}>
            <div className="gpx-tooltip-row gpx-tooltip-main">{fmt1(hoverPoint.distance)} km</div>
            {hoverPoint.ele != null && <div className="gpx-tooltip-row"><span>Altitude</span><b>{fmtInt(hoverPoint.ele)} m</b></div>}
            {hoverPoint.grade != null && <div className="gpx-tooltip-row"><span>Pente</span><b>{fmt1(hoverPoint.grade)} %</b></div>}
            {hoverPoint.speed != null && <div className="gpx-tooltip-row"><span>Vitesse</span><b>{fmt1(hoverPoint.speed)} km/h</b></div>}
            {hoverPoint.hr != null && <div className="gpx-tooltip-row"><span>FC</span><b>{fmtInt(hoverPoint.hr)} bpm</b></div>}
            {hoverPoint.cad != null && <div className="gpx-tooltip-row"><span>Cadence</span><b>{fmtInt(hoverPoint.cad)} rpm</b></div>}
            {hoverPoint.power != null && <div className="gpx-tooltip-row"><span>{powerLabel}</span><b>{fmtInt(hoverPoint.power)} W</b></div>}
            {hoverPoint.time && <div className="gpx-tooltip-row"><span>Heure</span><b>{fmtClock(hoverPoint.time)}</b></div>}
          </div>
        )}
      </div>
      {selectedClimb && (
        <div className="gpx-climb-inline-stats">
          <b>{selectedClimb.name}</b>
          <span>{fmt1(selectedClimb.lengthKm)} km</span>
          <span>+{fmtInt(selectedClimb.gain)} m</span>
          <span>{fmt1(selectedClimb.avgGrade)}% moy.</span>
          <span>{fmt1(selectedClimb.maxGrade)}% max</span>
          <button className="gpx-icon-btn" onClick={() => onSelectClimb(null)}><X size={13} /></button>
        </div>
      )}
    </div>
  );
}

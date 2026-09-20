/**
 * PROFILE CHART — profil (altitude / pente / vitesse / FC / cadence / puissance)
 * synchronisé avec la carte dans les deux sens : survol/glisser ici déplace le
 * marqueur sur la carte, et survoler le tracé sur la carte déplace le curseur
 * ici. Rendu en <canvas> pour rester fluide même avec beaucoup de points.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { X } from "lucide-react";

import { COLORS } from "../lib/colors.js";
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

export function ProfileChart({ analysis, decimated, metric, setMetric, hoverIdx, setHoverIdx, selectedClimb, onSelectClimb, height = 200 }) {
  const canvasRef = useRef(null);
  const wrapRef = useRef(null);
  const [width, setWidth] = useState(800);
  const metrics = useMemo(() => availableProfileMetrics(analysis), [analysis]);
  const activeMetric = metrics.find((m) => m.key === metric) || metrics[0];

  useEffect(() => {
    function onResize() {
      if (wrapRef.current) setWidth(wrapRef.current.clientWidth);
    }
    onResize();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  const dataKey = activeMetric ? activeMetric.dataKey : "ele";
  const values = decimated.map((p) => p[dataKey]).filter((v) => v != null);
  const minV = values.length ? Math.min(...values) : 0;
  const maxV = values.length ? Math.max(...values) : 1;
  const distMin = decimated[0] ? decimated[0].distance : 0;
  const distMax = decimated[decimated.length - 1] ? decimated[decimated.length - 1].distance : 1;

  const padL = 44,
    padR = 12,
    padT = 14,
    padB = 22;
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
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, width, height);

    (analysis.climbs || []).forEach((c) => {
      const x1 = xForDist(c.startDistance),
        x2 = xForDist(c.endDistance);
      ctx.fillStyle = selectedClimb && selectedClimb.id === c.id ? "rgba(244,183,64,0.22)" : "rgba(244,183,64,0.08)";
      ctx.fillRect(x1, padT, x2 - x1, height - padT - padB);
    });

    ctx.strokeStyle = "rgba(237,239,236,0.08)";
    ctx.lineWidth = 1;
    for (let i = 0; i <= 4; i++) {
      const y = padT + (i / 4) * (height - padT - padB);
      ctx.beginPath();
      ctx.moveTo(padL, y);
      ctx.lineTo(width - padR, y);
      ctx.stroke();
    }

    const accentMap = { altitude: COLORS.climb, pente: COLORS.climb, vitesse: COLORS.speed, fc: COLORS.effort, cadence: COLORS.info, puissance: COLORS.info };
    const stroke = accentMap[metric] || COLORS.speed;
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
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.lineTo(xForDist(distMax), yForVal(minV));
    ctx.lineTo(xForDist(distMin), yForVal(minV));
    ctx.closePath();
    ctx.fillStyle = stroke + "22";
    ctx.fill();

    ctx.fillStyle = "rgba(139,148,142,0.9)";
    ctx.font = "10.5px sans-serif";
    ctx.textAlign = "left";
    ctx.fillText(fmtAxisVal(metric, maxV), 2, padT + 8);
    ctx.fillText(fmtAxisVal(metric, minV), 2, height - padB);
    ctx.fillStyle = "rgba(139,148,142,0.7)";
    ctx.fillText(fmt1(distMin) + " km", padL + 2, height - 6);
    ctx.textAlign = "right";
    ctx.fillText(fmt1(distMax) + " km", width - padR, height - 6);

    if (hoverIdx != null && decimated[hoverIdx]) {
      const p = decimated[hoverIdx];
      const x = xForDist(p.distance);
      ctx.beginPath();
      ctx.moveTo(x, padT);
      ctx.lineTo(x, height - padB);
      ctx.strokeStyle = "rgba(255,255,255,0.4)";
      ctx.lineWidth = 1;
      ctx.stroke();
      const v = p[dataKey];
      if (v != null) {
        const y = yForVal(v);
        ctx.beginPath();
        ctx.arc(x, y, 4.5, 0, Math.PI * 2);
        ctx.fillStyle = stroke;
        ctx.fill();
        ctx.strokeStyle = "#0a0d0c";
        ctx.lineWidth = 1.5;
        ctx.stroke();
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [width, height, decimated, metric, hoverIdx, selectedClimb, analysis]);

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
      <div className="gpx-map-modes" style={{ marginBottom: 10 }}>
        {metrics.map((m) => (
          <button key={m.key} className={"gpx-chip" + (metric === m.key ? " gpx-chip-active" : "")} onClick={() => setMetric(m.key)}>
            {m.label}
          </button>
        ))}
      </div>
      <div style={{ position: "relative" }}>
        <canvas
          ref={canvasRef}
          onMouseMove={(e) => handleMove(e.clientX)}
          onMouseLeave={() => setHoverIdx(null)}
          onClick={(e) => handleClick(e.clientX)}
          onTouchStart={(e) => handleMove(e.touches[0].clientX)}
          onTouchMove={(e) => {
            e.preventDefault();
            handleMove(e.touches[0].clientX);
          }}
          style={{ display: "block", cursor: "crosshair", touchAction: "none", borderRadius: 12 }}
        />
        {hoverPoint && (
          <div className="gpx-tooltip" style={{ position: "absolute", top: 6, left: Math.min(width - 175, Math.max(0, xForDist(hoverPoint.distance) + 10)), pointerEvents: "none" }}>
            <div className="gpx-tooltip-row gpx-tooltip-main">{fmt1(hoverPoint.distance)} km</div>
            {hoverPoint.ele != null && <div className="gpx-tooltip-row"><span>Altitude</span><b>{fmtInt(hoverPoint.ele)} m</b></div>}
            {hoverPoint.grade != null && <div className="gpx-tooltip-row"><span>Pente</span><b>{fmt1(hoverPoint.grade)} %</b></div>}
            {hoverPoint.speed != null && <div className="gpx-tooltip-row"><span>Vitesse</span><b>{fmt1(hoverPoint.speed)} km/h</b></div>}
            {hoverPoint.hr != null && <div className="gpx-tooltip-row"><span>FC</span><b>{fmtInt(hoverPoint.hr)} bpm</b></div>}
            {hoverPoint.cad != null && <div className="gpx-tooltip-row"><span>Cadence</span><b>{fmtInt(hoverPoint.cad)} rpm</b></div>}
            {hoverPoint.power != null && <div className="gpx-tooltip-row"><span>Puissance</span><b>{fmtInt(hoverPoint.power)} W</b></div>}
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

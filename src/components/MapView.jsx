/**
 * MAP VIEW — vraie carte Leaflet + OpenStreetMap, via le vrai module npm
 * "leaflet" (fonctionne normalement en local, tuiles réelles avec rues,
 * routes, villes/villages). Le tracé, le départ, l'arrivée et les montées
 * sont posés sur cette carte à leurs coordonnées GPS réelles.
 */

import { useEffect, useMemo, useRef } from "react";
import { RefreshCw } from "lucide-react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

import { COLORS, SPEED_SCALE, GRADE_SCALE, HR_SCALE, ELE_SCALE, scaleColor } from "../lib/colors.js";
import { decimate, fmt1, fmtInt } from "../lib/utils.js";

function nearestIdxByLatLng(pts, lat, lon) {
  let best = 0,
    bestD = Infinity;
  for (let i = 0; i < pts.length; i++) {
    const dLat = pts[i].lat - lat,
      dLon = pts[i].lon - lon;
    const d = dLat * dLat + dLon * dLon;
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  return best;
}

const MAP_MODES = [
  { key: "track", label: "Parcours" },
  { key: "speed", label: "Vitesse" },
  { key: "altitude", label: "Altitude" },
  { key: "hr", label: "Fréq. cardiaque" },
  { key: "grade", label: "Pente" },
];

export function MapView({
  analysis,
  colorMode,
  setColorMode,
  selectedClimb,
  height = 460,
  decimated: decimatedProp,
  hoverIdx,
  onHoverIndex,
}) {
  const containerRef = useRef(null);
  const mapRef = useRef(null);
  const layerGroupRef = useRef(null);
  const cursorRef = useRef(null);
  const boundsRef = useRef(null);

  const ownDecimated = useMemo(() => decimate(analysis.series, 700), [analysis.series]);
  const decimated = decimatedProp || ownDecimated;

  const availableModes = MAP_MODES.filter((m) => {
    if (m.key === "hr") return analysis.hasHR;
    if (m.key === "grade" || m.key === "altitude") return analysis.hasEle;
    if (m.key === "speed") return analysis.hasTime;
    return true;
  });

  const metricRange = useMemo(() => {
    if (colorMode === "speed" && analysis.hasTime) {
      const vals = decimated.map((p) => p.speed).filter((v) => v != null);
      return [Math.min(...vals), Math.max(...vals)];
    }
    if (colorMode === "altitude" && analysis.hasEle) return [analysis.minEle, analysis.maxEle];
    if (colorMode === "hr" && analysis.hasHR) {
      const vals = decimated.map((p) => p.hr).filter((v) => v != null);
      return [Math.min(...vals), Math.max(...vals)];
    }
    if (colorMode === "grade" && analysis.hasEle) return [-8, 12];
    return [0, 1];
  }, [colorMode, decimated, analysis]);

  function segColor(p) {
    if (colorMode === "track") return COLORS.speed;
    const [lo, hi] = metricRange;
    const val = colorMode === "speed" ? p.speed : colorMode === "altitude" ? p.ele : colorMode === "hr" ? p.hr : p.grade;
    if (val == null || hi === lo) return COLORS.speed;
    const t = (val - lo) / (hi - lo);
    const stops = colorMode === "speed" ? SPEED_SCALE : colorMode === "altitude" ? ELE_SCALE : colorMode === "hr" ? HR_SCALE : GRADE_SCALE;
    return scaleColor(t, stops);
  }

  // Initialise la carte Leaflet une seule fois (module npm réel : tuiles
  // fonctionnelles ici, contrairement à l'aperçu Claude qui bloque ces requêtes).
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const map = L.map(containerRef.current, {
      zoomControl: true,
      attributionControl: true,
      scrollWheelZoom: true,
    });
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution:
        '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    }).addTo(map);
    const first = decimated[0];
    map.setView([first.lat, first.lon], 13);
    mapRef.current = map;
    setTimeout(() => map.invalidateSize(), 0);
    return () => {
      map.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Dessine / redessine le tracé, les marqueurs et ajuste le zoom sur le parcours.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    if (layerGroupRef.current) layerGroupRef.current.remove();
    const group = L.layerGroup().addTo(map);
    layerGroupRef.current = group;

    // Ligne large invisible : sert de zone de survol pour synchroniser le profil.
    if (onHoverIndex) {
      const hitLine = L.polyline(decimated.map((p) => [p.lat, p.lon]), {
        color: "#000",
        weight: 20,
        opacity: 0.001,
      }).addTo(group);
      hitLine.on("mousemove", (e) => onHoverIndex(nearestIdxByLatLng(decimated, e.latlng.lat, e.latlng.lng)));
      hitLine.on("mouseout", () => onHoverIndex(null));
    }

    if (colorMode === "track") {
      L.polyline(decimated.map((p) => [p.lat, p.lon]), {
        color: COLORS.speed,
        weight: 4,
        opacity: 0.9,
        lineJoin: "round",
      }).addTo(group);
    } else {
      for (let i = 1; i < decimated.length; i++) {
        L.polyline(
          [
            [decimated[i - 1].lat, decimated[i - 1].lon],
            [decimated[i].lat, decimated[i].lon],
          ],
          { color: segColor(decimated[i]), weight: 4, opacity: 0.9 }
        ).addTo(group);
      }
    }

    if (selectedClimb) {
      const seg = analysis.series.slice(selectedClimb.startIdx, selectedClimb.endIdx + 1);
      L.polyline(seg.map((p) => [p.lat, p.lon]), {
        color: COLORS.climb,
        weight: 6,
        opacity: 0.95,
        lineJoin: "round",
      }).addTo(group);
      const bounds = L.latLngBounds(seg.map((p) => [p.lat, p.lon]));
      map.flyToBounds(bounds, { padding: [40, 40], duration: 0.6 });
    }

    (analysis.climbs || []).forEach((c) => {
      const p = analysis.series[c.startIdx];
      L.circleMarker([p.lat, p.lon], {
        radius: 6,
        color: "#0a0d0c",
        weight: 2,
        fillColor: COLORS.climb,
        fillOpacity: 1,
      })
        .addTo(group)
        .bindPopup(`<b>${c.name}</b><br/>${fmt1(c.lengthKm)} km · +${fmtInt(c.gain)} m · ${fmt1(c.avgGrade)} %`);
    });

    const start = decimated[0],
      end = decimated[decimated.length - 1];
    L.circleMarker([start.lat, start.lon], { radius: 7, color: "#0a0d0c", weight: 2, fillColor: "#4dd9c0", fillOpacity: 1 })
      .addTo(group)
      .bindPopup("Départ");
    L.circleMarker([end.lat, end.lon], { radius: 7, color: "#0a0d0c", weight: 2, fillColor: "#e8543a", fillOpacity: 1 })
      .addTo(group)
      .bindPopup("Arrivée");

    if (!selectedClimb) {
      const bounds = L.latLngBounds(decimated.map((p) => [p.lat, p.lon]));
      boundsRef.current = bounds;
      map.invalidateSize();
      map.fitBounds(bounds, { padding: [28, 28] });
    }
  }, [analysis, colorMode, decimated, selectedClimb]);

  // Marqueur curseur : suit le survol du profil d'altitude (synchronisation graphique → carte).
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (hoverIdx == null || !decimated[hoverIdx]) {
      if (cursorRef.current) {
        cursorRef.current.remove();
        cursorRef.current = null;
      }
      return;
    }
    const p = decimated[hoverIdx];
    if (!cursorRef.current) {
      cursorRef.current = L.circleMarker([p.lat, p.lon], {
        radius: 8,
        color: "#fff",
        weight: 3,
        fillColor: COLORS.climb,
        fillOpacity: 1,
      }).addTo(map);
    } else {
      cursorRef.current.setLatLng([p.lat, p.lon]);
    }
  }, [hoverIdx, decimated]);

  function recenter() {
    const map = mapRef.current;
    if (map && boundsRef.current) map.fitBounds(boundsRef.current, { padding: [28, 28] });
  }

  return (
    <div className="gpx-map-block">
      <div className="gpx-map-toolbar">
        <div className="gpx-map-modes">
          {availableModes.map((m) => (
            <button
              key={m.key}
              className={"gpx-chip" + (colorMode === m.key ? " gpx-chip-active" : "")}
              onClick={() => setColorMode(m.key)}
            >
              {m.label}
            </button>
          ))}
        </div>
        <button className="gpx-icon-btn" onClick={recenter} title="Recentrer sur le parcours">
          <RefreshCw size={14} />
        </button>
      </div>
      <div className="gpx-leaflet-container" style={{ height }}>
        <div ref={containerRef} style={{ width: "100%", height: "100%" }} />
      </div>
      {colorMode !== "track" && (
        <div className="gpx-map-scale">
          <div
            className="gpx-map-scale-bar"
            style={{
              background: `linear-gradient(90deg, ${(colorMode === "speed" ? SPEED_SCALE : colorMode === "altitude" ? ELE_SCALE : colorMode === "hr" ? HR_SCALE : GRADE_SCALE).join(",")})`,
            }}
          />
          <div className="gpx-map-scale-labels">
            <span>{colorMode === "grade" ? "-8 %" : fmtInt(metricRange[0])}</span>
            <span>{colorMode === "grade" ? "+12 %" : fmtInt(metricRange[1])}</span>
          </div>
        </div>
      )}
    </div>
  );
}

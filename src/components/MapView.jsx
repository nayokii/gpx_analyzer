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

import {
  COLORS,
  SPEED_SCALE,
  GRADE_SCALE,
  HR_SCALE,
  ELE_SCALE,
  scaleColor,
  MAP_HALO_COLOR,
  MAP_HALO_OPACITY,
  MAP_MARKER_RING_COLOR,
} from "../lib/colors.js";
import { decimate, fmt1, fmtInt } from "../lib/utils.js";

/**
 * Dessine le halo/contour ("casing") sous un tracé : une plaque de séparation
 * quasi opaque entre le tracé et le fond de carte. Ne dessine jamais le
 * tracé lui-même — voir drawHaloPolyline pour un tracé complet (halo +
 * couleur), ou appeler cette fonction seule quand plusieurs segments colorés
 * doivent partager un unique halo continu (cas du tracé principal en mode
 * analytique, pour éviter un halo par segment inutilement coûteux).
 */
function drawTrackHalo(group, latlngs, { weight = 5, extraWeight = 3, color = MAP_HALO_COLOR, opacity = MAP_HALO_OPACITY } = {}) {
  return L.polyline(latlngs, {
    color,
    weight: weight + extraWeight,
    opacity,
    lineJoin: "round",
    lineCap: "round",
  }).addTo(group);
}

/**
 * Dessine une polyligne complète (halo + couleur) en une seule fois. Réutilisé
 * pour tout élément linéaire ponctuel comme la montée sélectionnée ; tout
 * futur tracé isolé (segment de comparaison, etc.) devrait faire de même.
 */
function drawHaloPolyline(group, latlngs, { color, weight = 5, opacity = 1, haloColor = MAP_HALO_COLOR, haloOpacity = MAP_HALO_OPACITY, haloExtraWeight = 3 } = {}) {
  drawTrackHalo(group, latlngs, { weight, extraWeight: haloExtraWeight, color: haloColor, opacity: haloOpacity });
  return L.polyline(latlngs, { color, weight, opacity, lineJoin: "round", lineCap: "round" }).addTo(group);
}

/**
 * Dessine un marqueur ponctuel avec un anneau clair derrière lui, pour qu'il
 * ne se confonde jamais avec les routes/chemins du fond de carte. Point
 * d'extension pour les futurs marqueurs (FC, puissance, cadence, meilleurs
 * efforts...) : il suffit d'appeler cette fonction avec une couleur de
 * remplissage différente, sans toucher au reste de l'architecture.
 */
function drawHaloMarker(group, latlng, { radius = 7, fillColor, ringColor = MAP_MARKER_RING_COLOR, strokeColor = COLORS.bg, strokeWeight = 2 }) {
  L.circleMarker(latlng, { radius: radius + 2, color: ringColor, weight: 0, fillColor: ringColor, fillOpacity: 0.9 }).addTo(group);
  return L.circleMarker(latlng, { radius, color: strokeColor, weight: strokeWeight, fillColor, fillOpacity: 1 }).addTo(group);
}

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

    // Couche 1 — halo/contour quasi opaque sous tout le tracé, quel que soit
    // le mode de couleur : c'est lui qui garantit la séparation nette avec le
    // fond de carte (routes claires, forêts, eau...), jamais la couleur
    // analytique seule. Un unique halo continu plutôt qu'un halo par segment
    // (coûteux, et inutile puisqu'il est neutre).
    drawTrackHalo(group, decimated.map((p) => [p.lat, p.lon]));

    // Couche 2 — couleur du tracé, toujours pleinement opaque : en mode
    // "Parcours" la couleur d'accent de l'app, sinon le dégradé analytique
    // choisi (vitesse/pente/FC/altitude).
    if (colorMode === "track") {
      L.polyline(decimated.map((p) => [p.lat, p.lon]), {
        color: COLORS.speed,
        weight: 5,
        opacity: 1,
        lineJoin: "round",
        lineCap: "round",
      }).addTo(group);
    } else {
      for (let i = 1; i < decimated.length; i++) {
        L.polyline(
          [
            [decimated[i - 1].lat, decimated[i - 1].lon],
            [decimated[i].lat, decimated[i].lon],
          ],
          { color: segColor(decimated[i]), weight: 5, opacity: 1, lineCap: "round" }
        ).addTo(group);
      }
    }

    if (selectedClimb) {
      const seg = analysis.series.slice(selectedClimb.startIdx, selectedClimb.endIdx + 1);
      const segLatLngs = seg.map((p) => [p.lat, p.lon]);
      // Halo clair (plutôt que le halo sombre standard) pour que la montée
      // sélectionnée ressorte aussi bien au-dessus du tracé déjà haloé.
      drawHaloPolyline(group, segLatLngs, {
        color: COLORS.climb,
        weight: 6,
        opacity: 1,
        haloColor: MAP_MARKER_RING_COLOR,
        haloOpacity: 0.95,
      });
      const bounds = L.latLngBounds(segLatLngs);
      map.flyToBounds(bounds, { padding: [40, 40], duration: 0.6 });
    }

    (analysis.climbs || []).forEach((c) => {
      const p = analysis.series[c.startIdx];
      drawHaloMarker(group, [p.lat, p.lon], { radius: 6, fillColor: COLORS.climb }).bindPopup(
        `<b>${c.name}</b><br/>${fmt1(c.lengthKm)} km · +${fmtInt(c.gain)} m · ${fmt1(c.avgGrade)} %`
      );
    });

    const start = decimated[0],
      end = decimated[decimated.length - 1];
    drawHaloMarker(group, [start.lat, start.lon], { radius: 7, fillColor: COLORS.speed }).bindPopup("Départ");
    drawHaloMarker(group, [end.lat, end.lon], { radius: 7, fillColor: COLORS.effort }).bindPopup("Arrivée");

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

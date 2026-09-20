/**
 * PROTOTYPE EXPÉRIMENTAL — comparaison visuelle Leaflet vs MapLibre GL JS.
 *
 * Ce composant est un test isolé, séparé de MapView.jsx (Leaflet, en
 * production). Il ne migre volontairement PAS : l'historique, le stockage,
 * l'import GPX/FIT, l'analyse, les graphiques, la synchronisation avancée
 * profil <-> carte, ni les montées/marqueurs secondaires.
 *
 * Trois choses à distinguer clairement (demandé explicitement) :
 * 1. Moteur de carte : MapLibre GL JS (rendu vectoriel, GPU).
 * 2. Données cartographiques : OpenStreetMap (via OpenFreeMap, voir plus bas).
 * 3. Style visuel : "Liberty", un style vectoriel prêt à l'emploi fourni par
 *    OpenFreeMap au-dessus de ces données OSM.
 *
 * Source cartographique retenue : OpenFreeMap (https://openfreemap.org)
 * - Gratuit, sans clé API, sans compte, sans limite de requêtes documentée
 *   (hébergement statique sur Cloudflare, financé par la bonne volonté du
 *   projet — à réévaluer si le service change de politique un jour).
 * - Données OpenStreetMap, mêmes données sous-jacentes que le fond Leaflet
 *   actuel : seul le rendu (vectoriel vs raster) et le style changent.
 * - Alternative de repli si OpenFreeMap devient indisponible : des tuiles
 *   raster OSM classiques (identiques à Leaflet) via une source "raster"
 *   MapLibre — pas utilisée ici pour tester réellement l'apport du rendu
 *   vectoriel, mais triviale à substituer (une seule constante à changer).
 */
import { useEffect, useRef, useState } from "react";
import { Map as MapLibreMap, NavigationControl, Marker, Popup, LngLatBounds } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";

import { COLORS, SPEED_SCALE, GRADE_SCALE, HR_SCALE, ELE_SCALE, scaleColor } from "../lib/colors.js";
import { decimate, fmtInt } from "../lib/utils.js";

const STYLE_URL = "https://tiles.openfreemap.org/styles/liberty";

const MAP_MODES = [
  { key: "track", label: "Parcours" },
  { key: "speed", label: "Vitesse" },
  { key: "altitude", label: "Altitude" },
  { key: "hr", label: "Fréq. cardiaque" },
  { key: "grade", label: "Pente" },
];

/**
 * Construit les arrêts d'un line-gradient MapLibre à partir de la même
 * logique de couleur que Leaflet (scaleColor + échelles de colors.js), pour
 * une comparaison honnête : seule la technique de rendu change, pas
 * l'encodage de la donnée. line-gradient exige des arrêts strictement
 * croissants -> les points à distance cumulée identique (arrêts) sont
 * fusionnés.
 */
function buildGradientStops(decimated, colorMode) {
  const total = decimated[decimated.length - 1].distance || 0;
  const raw = decimated.map((p) => {
    const progress = total > 0 ? Math.max(0, Math.min(1, p.distance / total)) : 0;
    const value = colorMode === "speed" ? p.speed : colorMode === "altitude" ? p.ele : colorMode === "hr" ? p.hr : p.grade;
    const color = colorMode === "track" ? COLORS.speed : colorForMode(value, colorMode, decimated);
    return { progress, color };
  });

  // line-gradient exige des arrêts strictement croissants : on ne garde un
  // point que s'il avance réellement (les arrêts/pauses à distance
  // cumulée identique sont fusionnés plutôt que de provoquer une erreur).
  const deduped = [];
  for (const r of raw) {
    if (deduped.length === 0 || r.progress > deduped[deduped.length - 1].progress) deduped.push(r);
  }
  if (deduped.length < 2) deduped.push({ progress: 1, color: deduped[0].color });

  // line-gradient exige un premier arrêt à 0 et un dernier à 1.
  deduped[0].progress = 0;
  deduped[deduped.length - 1].progress = 1;

  const stops = [];
  for (const { progress, color } of deduped) stops.push(progress, color);
  return stops;
}

function rangeForMode(colorMode, decimated) {
  if (colorMode === "speed") {
    const vals = decimated.map((p) => p.speed).filter((v) => v != null);
    return vals.length ? [Math.min(...vals), Math.max(...vals)] : [0, 1];
  }
  if (colorMode === "altitude") {
    const vals = decimated.map((p) => p.ele).filter((v) => v != null);
    return vals.length ? [Math.min(...vals), Math.max(...vals)] : [0, 1];
  }
  if (colorMode === "hr") {
    const vals = decimated.map((p) => p.hr).filter((v) => v != null);
    return vals.length ? [Math.min(...vals), Math.max(...vals)] : [0, 1];
  }
  if (colorMode === "grade") return [-8, 12];
  return [0, 1];
}

function colorForMode(val, colorMode, decimated) {
  if (val == null) return COLORS.textFaint;
  const [lo, hi] = rangeForMode(colorMode, decimated);
  const t = hi === lo ? 0 : (val - lo) / (hi - lo);
  const stops = colorMode === "speed" ? SPEED_SCALE : colorMode === "altitude" ? ELE_SCALE : colorMode === "hr" ? HR_SCALE : GRADE_SCALE;
  return scaleColor(t, stops);
}

function makeMarkerEl(fillColor) {
  const el = document.createElement("div");
  el.style.width = "16px";
  el.style.height = "16px";
  el.style.borderRadius = "50%";
  el.style.background = fillColor;
  el.style.border = `2px solid ${COLORS.bg}`;
  el.style.boxShadow = "0 0 0 2px rgba(255,255,255,0.9)";
  return el;
}

export function MapLibrePrototype({ analysis, height = 460 }) {
  const containerRef = useRef(null);
  const mapRef = useRef(null);
  const markersRef = useRef([]);
  const [colorMode, setColorMode] = useState("track");
  const [ready, setReady] = useState(false);
  const [loadError, setLoadError] = useState(null);

  const decimated = decimate(analysis.series, 700);

  const availableModes = MAP_MODES.filter((m) => {
    if (m.key === "hr") return analysis.hasHR;
    if (m.key === "grade" || m.key === "altitude") return analysis.hasEle;
    if (m.key === "speed") return analysis.hasTime;
    return true;
  });

  // Initialise la carte MapLibre une seule fois.
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const map = new MapLibreMap({
      container: containerRef.current,
      style: STYLE_URL,
      center: [decimated[0].lon, decimated[0].lat],
      zoom: 12,
      attributionControl: true,
    });
    map.addControl(new NavigationControl({ showCompass: false }), "top-right");
    map.on("load", () => setReady(true));
    map.on("error", (e) => setLoadError(e?.error?.message || "Erreur de chargement du style/tuiles MapLibre."));
    mapRef.current = map;
    return () => {
      map.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Dessine/redessine le tracé + marqueurs une fois le style chargé, et à
  // chaque changement de mode de couleur ou de parcours.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;

    const coords = decimated.map((p) => [p.lon, p.lat]);
    const geojson = {
      type: "Feature",
      properties: {},
      geometry: { type: "LineString", coordinates: coords },
    };

    const sourceId = "route";
    const outlineId = "route-outline";
    const lineId = "route-line";
    const gradient = ["interpolate", ["linear"], ["line-progress"], ...buildGradientStops(decimated, colorMode)];

    if (map.getSource(sourceId)) {
      map.getSource(sourceId).setData(geojson);
    } else {
      map.addSource(sourceId, { type: "geojson", lineMetrics: true, data: geojson });
      // Couche 1 — outline/séparation : plaque quasi opaque sous le tracé,
      // même principe que le halo Leaflet, mais avec une largeur qui suit le
      // zoom nativement (interpolate sur ["zoom"]).
      map.addLayer({
        id: outlineId,
        type: "line",
        source: sourceId,
        layout: { "line-cap": "round", "line-join": "round" },
        paint: {
          "line-color": COLORS.bg,
          "line-opacity": 0.9,
          "line-width": ["interpolate", ["linear"], ["zoom"], 10, 5, 16, 9],
        },
      });
      // Couche 2 — tracé coloré : line-gradient piloté par la donnée
      // analytique (ou couleur unique en mode "Parcours"), au-dessus du halo.
      map.addLayer({
        id: lineId,
        type: "line",
        source: sourceId,
        layout: { "line-cap": "round", "line-join": "round" },
        paint: {
          "line-width": ["interpolate", ["linear"], ["zoom"], 10, 3, 16, 6],
          "line-gradient": gradient,
        },
      });
    }

    if (map.getLayer(lineId)) {
      map.setPaintProperty(lineId, "line-gradient", gradient);
    }

    // Marqueurs départ/arrivée — simples, contrastés, sans effet superflu.
    markersRef.current.forEach((m) => m.remove());
    markersRef.current = [];
    const start = decimated[0];
    const end = decimated[decimated.length - 1];
    markersRef.current.push(new Marker({ element: makeMarkerEl(COLORS.speed) }).setLngLat([start.lon, start.lat]).setPopup(new Popup({ closeButton: false }).setText("Départ")).addTo(map));
    markersRef.current.push(new Marker({ element: makeMarkerEl(COLORS.effort) }).setLngLat([end.lon, end.lat]).setPopup(new Popup({ closeButton: false }).setText("Arrivée")).addTo(map));

    const bounds = coords.reduce((b, c) => b.extend(c), new LngLatBounds(coords[0], coords[0]));
    map.fitBounds(bounds, { padding: 40, duration: 0 });
  }, [ready, decimated, colorMode]);

  return (
    <div className="gpx-map-block">
      <div className="gpx-map-toolbar">
        <div className="gpx-map-modes">
          {availableModes.map((m) => (
            <button key={m.key} className={"gpx-chip" + (colorMode === m.key ? " gpx-chip-active" : "")} onClick={() => setColorMode(m.key)}>
              {m.label}
            </button>
          ))}
        </div>
      </div>
      <div className="gpx-leaflet-container" style={{ height, position: "relative" }}>
        <div ref={containerRef} style={{ width: "100%", height: "100%" }} />
        {loadError && (
          <div className="gpx-map-loading" style={{ color: COLORS.effort }}>
            Style/tuiles indisponibles : {loadError}
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * Carte d'une montée : tracé de la côte sur fond OpenStreetMap (Leaflet, comme
 * MapView.jsx), avec départ et arrivée, pour reconnaître où elle se trouve.
 */
import { useEffect, useRef } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

import { COLORS, MAP_HALO_COLOR, MAP_HALO_OPACITY, MAP_MARKER_RING_COLOR } from "../lib/colors.js";
import { resolveColor, useColorScheme } from "../lib/theme.js";

/**
 * @param {Object} props
 * @param {Array<[number, number]>} props.path - tracé [lat, lon] de la montée
 * @param {number} [props.height=260]
 */
export function ClimbMap({ path, height = 260 }) {
  const containerRef = useRef(null);
  const scheme = useColorScheme(); // redessine le tracé quand le thème change

  useEffect(() => {
    if (!containerRef.current || !path || path.length < 2) return undefined;
    const map = L.map(containerRef.current, { zoomControl: true, scrollWheelZoom: false });
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    }).addTo(map);

    const line = { lineJoin: "round", lineCap: "round" };
    L.polyline(path, { ...line, color: resolveColor(MAP_HALO_COLOR), weight: 8, opacity: MAP_HALO_OPACITY }).addTo(map);
    const route = L.polyline(path, { ...line, color: resolveColor(COLORS.climb), weight: 5 }).addTo(map);

    const dot = (latlng, fill, label) =>
      L.circleMarker(latlng, {
        radius: 7, color: resolveColor(MAP_MARKER_RING_COLOR), weight: 3, fillColor: fill, fillOpacity: 1,
      }).bindTooltip(label).addTo(map);
    dot(path[0], "#22c55e", "Départ");
    dot(path[path.length - 1], "#ef4444", "Arrivée");

    map.fitBounds(route.getBounds(), { padding: [30, 30] });
    setTimeout(() => map.invalidateSize(), 0);
    return () => map.remove();
  }, [path, scheme]);

  if (!path || path.length < 2) return null;
  return <div ref={containerRef} className="gpx-climb-map" style={{ height }} role="img" aria-label="Carte de la montée" />;
}

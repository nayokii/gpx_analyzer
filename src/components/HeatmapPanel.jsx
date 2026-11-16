/**
 * Carte de chaleur personnelle : toutes tes traces superposées sur une carte (Leaflet, comme MapView). L'opacité
 * s'additionne là où tu repasses souvent. Filtres par période et par type. Rien n'est envoyé nulle part ; les
 * tuiles OpenStreetMap sont les seules requêtes réseau, comme sur les autres cartes de l'app.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { Map as MapIcon } from "lucide-react";

import { SectionTitle } from "./UIPrimitives.jsx";
import { collectTracks, heatmapRange, HEATMAP_PERIODS } from "../lib/progress/heatmap.js";
import { sportKeys } from "../lib/progress/progress.js";
import { activityTypeLabel } from "../lib/feed/feedModel.js";
import { SHARE_ROUTE_COLOR } from "../lib/feed/shareCard.js";
import { useColorScheme } from "../lib/theme.js";
import { fmtInt } from "../lib/utils.js";

function HeatMap({ tracks, bounds, color }) {
  const ref = useRef(null);
  const scheme = useColorScheme();
  useEffect(() => {
    if (!ref.current || !tracks.length) return undefined;
    const map = L.map(ref.current, { preferCanvas: true, scrollWheelZoom: false });
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
      className: scheme === "dark" ? "gpx-heat-tiles-dark" : "",
    }).addTo(map);
    // Opacité faible : là où plusieurs traces se superposent, la couleur s'intensifie.
    const style = { color, weight: 3, opacity: 0.28, lineJoin: "round", lineCap: "round", interactive: false };
    for (const t of tracks) L.polyline(t, style).addTo(map);
    if (bounds) map.fitBounds(bounds, { padding: [24, 24] });
    setTimeout(() => map.invalidateSize(), 0);
    return () => map.remove();
  }, [tracks, bounds, color, scheme]);
  return <div ref={ref} className="gpx-heat-map" role="img" aria-label="Carte de chaleur de tes sorties" />;
}

/**
 * @param {Object} props
 * @param {Array|null} props.activities - sorties complètes (gpsTrack)
 * @param {boolean} props.loading
 * @param {number} [props.limit]
 */
export function HeatmapPanel({ activities, loading, limit }) {
  const [period, setPeriod] = useState("365d");
  const [sport, setSport] = useState("all");
  const sports = useMemo(() => sportKeys(activities || []), [activities]);
  const result = useMemo(() => {
    if (!activities) return null;
    const { from, to } = heatmapRange(period);
    return collectTracks(activities, { from, to, sport });
  }, [activities, period, sport]);

  return (
    <div className="gpx-panel">
      <SectionTitle icon={MapIcon}>Carte de chaleur</SectionTitle>
      {loading ? <p className="gpx-empty-note">Chargement de tes tracés…</p> : (
        <>
          <div className="gpx-progress-toolbar">
            <div className="gpx-map-modes" role="group" aria-label="Période">
              {HEATMAP_PERIODS.map((p) => (
                <button key={p.key} className={"gpx-chip" + (period === p.key ? " gpx-chip-active" : "")} aria-pressed={period === p.key} onClick={() => setPeriod(p.key)}>{p.label}</button>
              ))}
            </div>
            {sports.length > 1 && (
              <div className="gpx-map-modes" role="group" aria-label="Type de sortie">
                <button className={"gpx-chip" + (sport === "all" ? " gpx-chip-active" : "")} aria-pressed={sport === "all"} onClick={() => setSport("all")}>Tous</button>
                {sports.map((s) => (
                  <button key={s} className={"gpx-chip" + (sport === s ? " gpx-chip-active" : "")} aria-pressed={sport === s} onClick={() => setSport(s)}>{activityTypeLabel(s)}</button>
                ))}
              </div>
            )}
          </div>
          {result && result.count > 0 ? (
            <>
              <p className="gpx-progress-sub">{result.count} sortie{result.count > 1 ? "s" : ""} · {fmtInt(result.distanceKm)} km — les routes les plus roulées ressortent le plus.</p>
              <HeatMap tracks={result.tracks} bounds={result.bounds} color={SHARE_ROUTE_COLOR} />
            </>
          ) : (
            <p className="gpx-empty-note">Aucun tracé GPS sur cette période.</p>
          )}
          {limit && <p className="gpx-progress-sub">Limité aux {limit} sorties les plus récentes.</p>}
        </>
      )}
    </div>
  );
}

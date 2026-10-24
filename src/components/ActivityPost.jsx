/**
 * Une publication du fil d'activités : en-tête, carte du tracé, statistiques,
 * actions.
 *
 * Légèreté : le tracé est un SVG calculé depuis les coordonnées réelles (aucune
 * carte Leaflet interactive par publication). Le détail de la sortie (tracé,
 * altitude) n'est chargé que lorsque la publication approche de l'écran
 * (IntersectionObserver) et mis en cache en mémoire.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { Pencil, Check, X, Share2, Trash2, ExternalLink, MapPinOff, Loader2 } from "lucide-react";

import {
  extractRoute, simplifyRoute, projectRoute, pointsToPath, elevationProfile, buildStats, activityTypeLabel, displayName,
} from "../lib/feed/feedModel.js";
import { MAX_NAME_LENGTH } from "../lib/feed/nameOverrides.js";

const MAP_W = 800;
const MAP_H = 480;

// Cache mémoire des détails déjà chargés (borné, le plus ancien est évincé).
const detailCache = new Map();
const CACHE_MAX = 60;
export function __clearDetailCacheForTests() { detailCache.clear(); }
function cacheSet(id, value) {
  if (detailCache.size >= CACHE_MAX) detailCache.delete(detailCache.keys().next().value);
  detailCache.set(id, value);
}

/** Tracé en SVG, contrasté, avec départ et arrivée identifiables. */
export function RouteMap({ activity, label }) {
  const geometry = useMemo(() => {
    const coords = extractRoute(activity);
    if (!coords) return null;
    const projected = projectRoute(simplifyRoute(coords, 500), { width: MAP_W, height: MAP_H, padding: 56 });
    return projected && { d: pointsToPath(projected.points), start: projected.points[0], end: projected.points[projected.points.length - 1] };
  }, [activity]);

  if (!geometry) {
    return (
      <div className="gpx-post-map gpx-post-map--empty" role="img" aria-label="Tracé GPS indisponible">
        <MapPinOff size={26} />
        <span>Pas de tracé GPS exploitable pour cette sortie</span>
      </div>
    );
  }
  return (
    <div className="gpx-post-map">
      <svg className="gpx-post-route" viewBox={`0 0 ${MAP_W} ${MAP_H}`} preserveAspectRatio="xMidYMid meet" role="img" aria-label={label}>
        <defs>
          <pattern id="gpx-post-grid" width="48" height="48" patternUnits="userSpaceOnUse">
            <path d="M48 0H0V48" fill="none" stroke="var(--feed-grid)" strokeWidth="1" />
          </pattern>
        </defs>
        <rect width={MAP_W} height={MAP_H} fill="url(#gpx-post-grid)" />
        <path d={geometry.d} fill="none" stroke="var(--map-halo)" strokeWidth="13" strokeLinecap="round" strokeLinejoin="round" />
        <path d={geometry.d} fill="none" stroke="var(--feed-route)" strokeWidth="6" strokeLinecap="round" strokeLinejoin="round" />
        <circle cx={geometry.start.x} cy={geometry.start.y} r="12" fill="var(--map-halo)" />
        <circle cx={geometry.start.x} cy={geometry.start.y} r="7.5" fill="var(--feed-route)" />
        <circle cx={geometry.end.x} cy={geometry.end.y} r="12" fill="var(--map-halo)" />
        <circle cx={geometry.end.x} cy={geometry.end.y} r="7.5" fill="var(--text)" />
      </svg>
      <span className="gpx-post-map-legend"><i className="start" /> Départ <i className="end" /> Arrivée</span>
    </div>
  );
}

function ElevationSpark({ activity }) {
  const profile = useMemo(() => elevationProfile(activity, 80), [activity]);
  if (!profile) return null;
  const W = 800, H = 70;
  const pts = profile.values.map((v, i) => [(i / (profile.values.length - 1)) * W, H - 6 - ((v - profile.min) / (profile.max - profile.min)) * (H - 14)]);
  const line = pts.map((p, i) => `${i ? "L" : "M"}${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join(" ");
  return (
    <svg className="gpx-post-profile" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label={`Profil d'altitude, de ${Math.round(profile.min)} à ${Math.round(profile.max)} mètres`}>
      <path d={`${line} L${W} ${H} L0 ${H} Z`} fill="var(--feed-route)" opacity="0.14" />
      <path d={line} fill="none" stroke="var(--feed-route)" strokeWidth="2.5" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

function fmtPostDate(iso) {
  if (!iso) return "Date inconnue";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "Date inconnue";
  return d.toLocaleDateString("fr-FR", { weekday: "short", day: "numeric", month: "long", year: "numeric" });
}

export function ActivityPost({ summary, overrides, onRename, onOpen, onShare, onDelete, repository }) {
  const ref = useRef(null);
  const [detail, setDetail] = useState(() => detailCache.get(summary.id) || null);
  const [state, setState] = useState(detail ? "ready" : "idle"); // idle | loading | ready | error
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const inputRef = useRef(null);

  // Le composant est-il encore monté ? (la requête de détail ne doit pas être
  // annulée par le changement d'état "idle" → "loading" qu'elle provoque elle-même)
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  // Chargement différé du détail à l'approche de l'écran.
  const idle = state === "idle";
  useEffect(() => {
    if (!idle) return undefined;
    const load = () => {
      setState("loading");
      repository
        .loadActivityDetail(summary.id)
        .then((full) => {
          if (!mountedRef.current) return;
          cacheSet(summary.id, full);
          setDetail(full);
          setState("ready");
        })
        .catch(() => { if (mountedRef.current) setState("error"); });
    };
    const el = ref.current;
    if (!el || typeof IntersectionObserver === "undefined") {
      load();
      return undefined;
    }
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) { io.disconnect(); load(); }
    }, { rootMargin: "400px 0px" });
    io.observe(el);
    return () => io.disconnect();
  }, [idle, repository, summary.id]);

  useEffect(() => { if (editing && inputRef.current) { inputRef.current.focus(); inputRef.current.select(); } }, [editing]);

  const merged = useMemo(() => (detail ? { ...summary, ...detail, id: summary.id } : summary), [summary, detail]);
  const name = displayName(summary, overrides);
  const renamed = !!(overrides && overrides[summary.id]);
  const { primary, secondary } = useMemo(() => buildStats(merged), [merged]);
  const hero = primary.find((s) => s.key === "distance");
  const others = primary.filter((s) => s.key !== "distance");

  function startEdit() { setDraft(name); setEditing(true); }
  function commit(e) {
    e && e.preventDefault();
    onRename(summary.id, draft);
    setEditing(false);
  }

  return (
    <article ref={ref} className="gpx-post" aria-label={name}>
      <header className="gpx-post-head">
        <div className="gpx-post-eyebrow">
          <time dateTime={summary.date || undefined}>{fmtPostDate(summary.date)}</time>
          <span className="gpx-post-type">{activityTypeLabel(summary.sportType)}</span>
        </div>
        {editing ? (
          <form className="gpx-post-rename" onSubmit={commit}>
            <input
              ref={inputRef}
              value={draft}
              maxLength={MAX_NAME_LENGTH}
              aria-label="Nom de la sortie"
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Escape") setEditing(false); }}
            />
            <button type="submit" className="gpx-icon-btn" aria-label="Enregistrer le nom"><Check size={16} /></button>
            <button type="button" className="gpx-icon-btn" aria-label="Annuler" onClick={() => setEditing(false)}><X size={16} /></button>
          </form>
        ) : (
          <h2 className="gpx-post-title">
            <span>{name}</span>
            <button className="gpx-icon-btn gpx-icon-btn--sm" onClick={startEdit} aria-label={`Renommer ${name}`} title="Renommer (le fichier original n'est pas modifié)"><Pencil size={14} /></button>
            {renamed && <span className="gpx-post-renamed">renommée</span>}
          </h2>
        )}
      </header>

      {state === "loading" || state === "idle" ? (
        <div className="gpx-post-map gpx-post-map--loading" aria-busy="true"><Loader2 size={22} className="gpx-spin" /><span>Chargement du tracé…</span></div>
      ) : state === "error" ? (
        <div className="gpx-post-map gpx-post-map--empty" role="alert"><MapPinOff size={26} /><span>Impossible de charger le tracé de cette sortie</span></div>
      ) : (
        <RouteMap activity={merged} label={`Tracé de ${name}`} />
      )}

      {hero && (
        <div className="gpx-post-hero">
          <span className="gpx-post-hero-value">{hero.value}</span>
          <span className="gpx-post-hero-unit">{hero.unit}</span>
        </div>
      )}
      {others.length > 0 && (
        <dl className="gpx-post-stats">
          {others.map((s) => (
            <div key={s.key}>
              <dt>{s.label}</dt>
              <dd>{s.value}{s.unit && <small>{s.unit}</small>}</dd>
            </div>
          ))}
        </dl>
      )}

      {state === "ready" && <ElevationSpark activity={merged} />}

      {secondary.length > 0 && (
        <ul className="gpx-post-extra">
          {secondary.map((s) => (
            <li key={s.key}>
              <span>{s.label}</span> <b>{s.value}{s.unit ? ` ${s.unit}` : ""}</b>
              {s.kind === "estimated" && <em className="gpx-power-source-estimated">estimée</em>}
              {s.key === "power" && s.kind === "measured" && <em className="gpx-power-source">mesurée</em>}
            </li>
          ))}
        </ul>
      )}

      <footer className="gpx-post-actions">
        <button className="gpx-btn-primary" onClick={() => onOpen(summary.id)}><ExternalLink size={15} /> <span>Ouvrir la sortie</span></button>
        <button className="gpx-btn-ghost" onClick={() => onShare(summary, merged)} disabled={state !== "ready"}><Share2 size={15} /> <span>Partager</span></button>
        {onDelete && (
          <button className="gpx-btn-ghost" onClick={() => onDelete(summary.id, name)} aria-label={`Supprimer ${name}`}><Trash2 size={15} /> <span>Supprimer</span></button>
        )}
      </footer>
    </article>
  );
}

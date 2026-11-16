/**
 * MONTÉES — répertorie les montées détectées dans l'historique, regroupées par
 * col/route (voir lib/climbs/climbRegistry.js). L'utilisateur nomme chaque
 * montée (stocké localement, voir lib/climbs/climbNames.js) puis suit ses
 * chronos et sa progression sur chacune.
 *
 * Comme Coach/Tour, cette vue charge l'historique via les hooks partagés
 * (`useActivityRepository` + `useUnifiedActivities`) et ne fait que lecture :
 * jamais d'écriture d'activité.
 */
import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, Mountain, TrendingUp, Timer, Pencil, ExternalLink, RefreshCw } from "lucide-react";
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip } from "recharts";

import { ClimbMap } from "./ClimbMap.jsx";
import { StorageSettings } from "./StorageSettings.jsx";
import { SectionTitle, StatCard, PageHead } from "./UIPrimitives.jsx";
import { useActivityRepository, useUnifiedActivities } from "./useActivityRepository.js";
import { useClimbNames } from "./useClimbNames.js";
import { getCachedClimbGroups } from "../lib/derivedCache.js";
import { summarizeAttempts, compareLatestToBest } from "../lib/climbs/climbRegistry.js";
import { findClimbName, findClimbStrava, MAX_NAME_LENGTH } from "../lib/climbs/climbNames.js";
import { loadStravaState, findStravaSegmentsForClimbs, StravaApiUnavailableError } from "../lib/strava/index.js";
import { COLORS, CHART_TOOLTIP_STYLE, CHART_AXIS } from "../lib/colors.js";
import { fmt1, fmtInt, fmtDuration } from "../lib/utils.js";

const MAX_CLIMB_ACTIVITIES = 200;
const STRAVA_CATEGORIES = { 1: "Cat. 4", 2: "Cat. 3", 3: "Cat. 2", 4: "Cat. 1", 5: "Hors catégorie" };

function stravaErrorMessage(err) {
  if (err instanceof StravaApiUnavailableError && (err.status === 401 || err.status === 403)) {
    return "Strava a refusé l'accès aux segments. Reconnecte Strava dans Sources de données (l'autorisation de lecture des segments est nécessaire).";
  }
  return err && err.message ? err.message : "Impossible de récupérer les segments Strava.";
}

function shortDate(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  return isNaN(d) ? "—" : d.toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit", year: "2-digit" });
}

function fmtDelta(sec) {
  if (sec == null) return null;
  const abs = Math.abs(Math.round(sec));
  if (abs === 0) return "= record";
  return `${sec < 0 ? "−" : "+"}${fmtDuration(abs)}`;
}

function ClimbNameField({ name, onSave }) {
  const [draft, setDraft] = useState(name || "");
  const commit = () => { if (draft.trim() !== (name || "")) onSave(draft); };
  return (
    <label className="gpx-climb-name">
      <Pencil size={13} aria-hidden="true" />
      <input
        type="text"
        value={draft}
        maxLength={MAX_NAME_LENGTH}
        placeholder="Donne un nom à cette montée"
        aria-label="Nom de la montée"
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); }}
      />
    </label>
  );
}

function ProgressionChart({ attempts }) {
  const data = attempts
    .filter((a) => a.durationSec != null && a.durationSec > 0)
    .map((a) => ({ x: shortDate(a.date), value: a.durationSec }));
  if (data.length < 2) return <p className="gpx-empty-note">Il faut au moins deux passages chronométrés pour voir une progression.</p>;
  return (
    <ResponsiveContainer width="100%" height={180}>
      <LineChart data={data} margin={{ top: 6, right: 18, bottom: 0, left: -6 }}>
        <CartesianGrid stroke={COLORS.border} vertical={false} />
        <XAxis dataKey="x" {...CHART_AXIS} interval="preserveStartEnd" minTickGap={28} />
        <YAxis {...CHART_AXIS} width={48} reversed domain={["dataMin - 10", "dataMax + 10"]} tickFormatter={(v) => fmtDuration(v)} tickCount={4} />
        <Tooltip formatter={(v) => [fmtDuration(v), "Temps"]} contentStyle={CHART_TOOLTIP_STYLE} />
        <Line type="monotone" dataKey="value" stroke={COLORS.climb} dot={{ r: 3 }} strokeWidth={2} isAnimationActive={false} />
      </LineChart>
    </ResponsiveContainer>
  );
}

function ClimbDetail({ group, name, strava, summary, onSaveName, onOpen }) {
  const rows = group.attempts.slice().reverse();
  const comparison = compareLatestToBest(group.attempts);
  return (
    <div className="gpx-panel">
      <SectionTitle icon={Mountain}>{name || "Montée sans nom"}</SectionTitle>
      <ClimbNameField key={group.id} name={name} onSave={onSaveName} />
      {strava && (
        <p className="gpx-climb-strava">
          Segment Strava : <b>{strava.name}</b>{STRAVA_CATEGORIES[strava.category] ? ` · ${STRAVA_CATEGORIES[strava.category]}` : ""}{" "}
          <a href={`https://www.strava.com/segments/${strava.id}`} target="_blank" rel="noopener noreferrer">
            Voir sur Strava <ExternalLink size={12} aria-hidden="true" />
          </a>
        </p>
      )}
      <ClimbMap key={group.id} path={group.path} />
      <div className="gpx-stats-grid">
        <StatCard icon={Mountain} label="Longueur" value={fmt1(group.distanceM / 1000)} unit="km" accent={COLORS.climb} />
        <StatCard icon={TrendingUp} label="D+" value={fmtInt(group.gainM)} unit="m" accent={COLORS.climb} />
        <StatCard icon={TrendingUp} label="Pente moyenne" value={fmt1(group.avgGrade)} unit="%" accent={COLORS.climb} />
        <StatCard icon={Timer} label="Meilleur temps" value={summary.best ? fmtDuration(summary.best.durationSec) : null} accent={COLORS.speed} />
        <StatCard
          icon={Timer}
          label="Dernier passage"
          value={summary.latest ? fmtDuration(summary.latest.durationSec) : null}
          accent={COLORS.info}
          sub={summary.deltaVsPreviousBestSec != null ? `${fmtDelta(summary.deltaVsPreviousBestSec)} vs ancien record` : undefined}
        />
        <StatCard icon={Mountain} label="Passages" value={fmtInt(group.attempts.length)} accent={COLORS.info} />
      </div>

      {comparison && (
        <p className={"gpx-climb-insight gpx-climb-insight--" + comparison.kind}>
          <b>Dernier passage vs meilleur précédent ({fmtDelta(comparison.timeDeltaSec)})</b>
          <br />
          {comparison.message}
          {comparison.hrDeltaBpm != null && Math.abs(comparison.hrDeltaBpm) >= 1 && (
            <> FC moyenne {comparison.hrDeltaBpm > 0 ? "+" : "−"}{Math.abs(Math.round(comparison.hrDeltaBpm))} bpm.</>
          )}
        </p>
      )}

      <div className="gpx-chart-card-title" style={{ marginTop: 14 }}>Progression du chrono</div>
      <ProgressionChart attempts={group.attempts} />

      <div className="gpx-table-wrap" style={{ marginTop: 12 }}>
        <table className="gpx-table">
          <thead>
            <tr>
              <th>Date</th><th>Temps</th><th>Vitesse</th><th>VAM</th><th>Puissance</th><th>FC</th><th />
            </tr>
          </thead>
          <tbody>
            {rows.map((a, i) => {
              const isBest = summary.best && a.activityId === summary.best.activityId && a.durationSec === summary.best.durationSec;
              return (
                <tr key={`${a.activityId}-${i}`}>
                  <td>{shortDate(a.date)}</td>
                  <td>{a.durationSec != null ? fmtDuration(a.durationSec) : "—"}{isBest && <span className="gpx-badge-best" style={{ marginLeft: 8 }}>Record</span>}</td>
                  <td>{a.avgSpeedKmh != null ? `${fmt1(a.avgSpeedKmh)} km/h` : "—"}</td>
                  <td>{a.vam != null ? `${fmtInt(a.vam)} m/h` : "—"}</td>
                  <td>{a.avgPowerW != null ? `${fmtInt(a.avgPowerW)} W` : "—"}</td>
                  <td>{a.avgHeartRateBpm != null ? `${fmtInt(a.avgHeartRateBpm)} bpm` : "—"}</td>
                  <td>{onOpen && <button className="gpx-link-btn" onClick={() => onOpen(a.activityId)}>Ouvrir la sortie</button>}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/**
 * @param {Object} props
 * @param {Object} props.storage - { status, rootHandle }
 * @param {Function} props.onConnect
 * @param {Function} props.onReconnect
 * @param {Function} props.onOpen - ouvre une sortie par id
 * @param {Function} props.onBack
 * @param {Object} [props.userSettings]
 */
export function ClimbsView({ storage, onConnect, onReconnect, onOpen, onBack, userSettings }) {
  const { repository } = useActivityRepository(storage, userSettings);
  const { summaries, summariesError, fullActivities } = useUnifiedActivities(repository, { max: MAX_CLIMB_ACTIVITIES });
  const rootHandle = storage.status === "connected" ? storage.rootHandle : null;
  const { names, rename, linkStrava } = useClimbNames(rootHandle);
  const [stravaState, setStravaState] = useState(null);
  const [stravaBusy, setStravaBusy] = useState(false);
  const [stravaNote, setStravaNote] = useState(null);

  useEffect(() => {
    if (!rootHandle) { setStravaState(null); return undefined; }
    let cancelled = false;
    loadStravaState(rootHandle).then((st) => { if (!cancelled) setStravaState(st); });
    return () => { cancelled = true; };
  }, [rootHandle]);
  const [selectedId, setSelectedId] = useState(null);

  const ready = storage.status === "connected" || repository.hasCloud;

  const groups = useMemo(() => (fullActivities ? getCachedClimbGroups(fullActivities) : null), [fullActivities]);
  const unlinked = groups ? groups.filter((g) => !findClimbStrava(names, g)) : [];

  async function fetchStravaSegments() {
    if (!rootHandle || !stravaState || unlinked.length === 0) return;
    setStravaBusy(true);
    setStravaNote(null);
    try {
      const { matches, searched, rateLimited } = await findStravaSegmentsForClimbs({
        rootHandle, state: stravaState, groups: unlinked,
        onProgress: (done, total) => setStravaNote(`Recherche des segments Strava… ${done}/${total}`),
      });
      linkStrava(matches);
      setStravaNote(
        `${matches.length} montée${matches.length > 1 ? "s" : ""} rapprochée${matches.length > 1 ? "s" : ""} d'un segment Strava sur ${searched} cherchée${searched > 1 ? "s" : ""}.` +
        (rateLimited ? " Limite de requêtes Strava atteinte : relance dans quelques minutes pour les autres." : "")
      );
    } catch (err) {
      setStravaNote(stravaErrorMessage(err));
    } finally {
      setStravaBusy(false);
    }
  }

  const selected = groups ? groups.find((g) => g.id === selectedId) || groups[0] || null : null;

  return (
    <div className="gpx-dashboard gpx-ds">
      <PageHead
        title="Montées"
        meta={groups ? <span>{groups.length} montée{groups.length > 1 ? "s" : ""} détectée{groups.length > 1 ? "s" : ""}</span> : ready ? <span>Chargement…</span> : null}
        actions={<button className="gpx-btn-ghost" onClick={onBack}><ArrowLeft size={15} /> <span>Retour</span></button>}
      />

      <div className="gpx-statusline">
        <StorageSettings storage={storage} onConnect={onConnect} onReconnect={onReconnect} />
      </div>

      {ready && (
        <>
          {summariesError && <div className="gpx-error-box" style={{ marginBottom: 14 }}>{summariesError}</div>}
          {summaries == null || (summaries.length > 0 && groups == null) ? (
            <div className="gpx-panel"><p className="gpx-empty-note">Analyse de ton historique…</p></div>
          ) : summaries.length === 0 || groups.length === 0 ? (
            <div className="gpx-panel">
              <p className="gpx-summary-text">Aucune montée détectée pour l'instant.</p>
              <p className="gpx-empty-note">Une montée apparaît dès qu'une sortie avec altitude contient une côte d'au moins 300 m et 25 m de D+.</p>
            </div>
          ) : (
            <>
              <div className="gpx-panel">
                <SectionTitle icon={Mountain}>Tes montées</SectionTitle>
                {stravaState && stravaState.connected ? (
                  <div className="gpx-climb-strava-bar">
                    <button className="gpx-btn-ghost" onClick={fetchStravaSegments} disabled={stravaBusy || unlinked.length === 0}>
                      <RefreshCw size={14} aria-hidden="true" /> <span>{unlinked.length === 0 ? "Segments Strava à jour" : `Récupérer les segments Strava (${unlinked.length})`}</span>
                    </button>
                    {stravaNote && <span className="gpx-empty-note" role="status">{stravaNote}</span>}
                  </div>
                ) : (
                  <p className="gpx-empty-note">Connecte Strava dans Sources de données pour retrouver le nom officiel de tes montées.</p>
                )}
                <ul className="gpx-climb-list">
                  {groups.map((g) => {
                    const name = findClimbName(names, g);
                    const sum = summarizeAttempts(g.attempts);
                    return (
                      <li key={g.id}>
                        <button
                          type="button"
                          className={"gpx-climb-item" + (selected && selected.id === g.id ? " active" : "")}
                          aria-pressed={!!selected && selected.id === g.id}
                          onClick={() => setSelectedId(g.id)}
                        >
                          <span className="gpx-climb-item-name">{name || "Montée sans nom"}</span>
                          <span className="gpx-climb-item-meta">
                            {fmt1(g.distanceM / 1000)} km · {fmtInt(g.gainM)} m D+ · {fmt1(g.avgGrade)} % · {g.attempts.length} passage{g.attempts.length > 1 ? "s" : ""}
                          </span>
                          {sum.isLatestBest && <span className="gpx-badge-best">Record battu</span>}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </div>

              {selected && (
                <ClimbDetail
                  group={selected}
                  name={findClimbName(names, selected)}
                  strava={findClimbStrava(names, selected)}
                  summary={summarizeAttempts(selected.attempts)}
                  onSaveName={(raw) => rename(selected, raw)}
                  onOpen={onOpen}
                />
              )}
            </>
          )}
        </>
      )}
    </div>
  );
}

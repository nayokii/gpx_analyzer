/**
 * Boîte de dialogue « Partager » : aperçu avant export et réglages en quatre onglets — Style (format, mise en page,
 * fond), Texte (police, taille, chiffres), Tracé (couleur, épaisseur, taille, position) et Éléments (titre, date,
 * grille, confidentialité) — puis téléchargement PNG ou partage natif. Les réglages sont mémorisés sur l'appareil.
 */
import { useEffect, useRef, useState } from "react";
import { X, Download, Share2, ShieldCheck, RotateCcw } from "lucide-react";

import { ActivityShareCard } from "./ActivityShareCard.jsx";
import { useColorScheme } from "../lib/theme.js";
import { Slider, FormatPicker, BackgroundPicker, FontPicker, AccentPicker } from "./ShareControls.jsx";
import {
  SHARE_FORMATS, SHARE_STYLES, SHARE_PARTS, SHARE_ADJUST,
  HIDEABLE_STATS, EXTRA_STATS, buildShareModel, exportShareCardPng, shareFileName, shareOrDownload, downloadBlob,
} from "../lib/feed/shareCard.js";
import { extractRoute } from "../lib/feed/feedModel.js";

const STORAGE_KEY = "cycling-os-share-prefs";
const TABS = [
  { key: "style", label: "Style" },
  { key: "text", label: "Texte" },
  { key: "route", label: "Tracé" },
  { key: "parts", label: "Éléments" },
];

const DEFAULTS = {
  format: "story", style: "classic", font: "system", accent: null, hidden: [], hiddenParts: [], extra: [],
  hidePlaces: true, simplify: true,
  textScale: SHARE_ADJUST.textScale.def, routeScale: SHARE_ADJUST.routeScale.def, routeX: SHARE_ADJUST.routeX.def,
  routeY: SHARE_ADJUST.routeY.def, routeWidth: SHARE_ADJUST.routeWidth.def,
};

function loadPrefs() {
  try {
    const raw = JSON.parse(window.localStorage.getItem(STORAGE_KEY) || "null");
    if (!raw || typeof raw !== "object") return {};
    const out = {};
    for (const k of Object.keys(DEFAULTS)) if (k in raw && typeof raw[k] === typeof DEFAULTS[k] || (k === "accent" && (raw[k] === null || typeof raw[k] === "string"))) out[k] = raw[k];
    return out;
  } catch {
    return {};
  }
}

function savePrefs(prefs) {
  try { window.localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs)); } catch { /* stockage indisponible : réglages non mémorisés */ }
}

export function ActivityShareDialog({ activity, name, onClose }) {
  const systemScheme = useColorScheme();
  const [prefs, setPrefs] = useState(() => ({ ...DEFAULTS, ...loadPrefs() }));
  const [theme, setTheme] = useState(systemScheme);
  const [tab, setTab] = useState("style");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(null);
  const closeRef = useRef(null);

  useEffect(() => { savePrefs(prefs); }, [prefs]);
  useEffect(() => {
    closeRef.current && closeRef.current.focus();
    const onKey = (e) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const canNativeShare = typeof navigator !== "undefined" && typeof navigator.share === "function";
  const hasRoute = !!extractRoute(activity);
  const set = (key, value) => setPrefs((p) => ({ ...p, [key]: value }));
  const toggle = (key, item) => setPrefs((p) => ({ ...p, [key]: p[key].includes(item) ? p[key].filter((k) => k !== item) : [...p[key], item] }));
  const options = { name, theme, ...prefs };
  const { format } = prefs;

  async function run(native) {
    setBusy(true);
    setMessage(null);
    try {
      const blob = await exportShareCardPng(buildShareModel(activity, options));
      const fileName = shareFileName(name || activity.name, format, theme);
      if (native) {
        const outcome = await shareOrDownload(blob, fileName);
        if (outcome === "downloaded") setMessage({ type: "ok", text: "Partage natif indisponible : l'image a été téléchargée." });
        else if (outcome === "shared") setMessage({ type: "ok", text: "Image partagée." });
      } else {
        downloadBlob(blob, fileName);
        setMessage({ type: "ok", text: `Image ${SHARE_FORMATS[format].width} × ${SHARE_FORMATS[format].height} téléchargée.` });
      }
    } catch (err) {
      setMessage({ type: "error", text: err.message || "L'export a échoué." });
    } finally {
      setBusy(false);
    }
  }

  const f = SHARE_FORMATS[format];
  return (
    <div className="gpx-share-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="gpx-share-dialog" role="dialog" aria-modal="true" aria-labelledby="gpx-share-title">
        <div className="gpx-share-head">
          <h2 id="gpx-share-title">Partager cette sortie</h2>
          <button ref={closeRef} className="gpx-icon-btn" onClick={onClose} aria-label="Fermer"><X size={18} /></button>
        </div>

        <div className="gpx-share-body">
          <div className={"gpx-share-preview gpx-share-preview--" + format + (theme === "transparent" ? " gpx-share-preview--transparent" : "")}>
            <ActivityShareCard activity={activity} name={name} format={format} theme={theme} {...prefs} />
          </div>

          <div className="gpx-share-controls">
            <div className="gpx-share-tabs" role="tablist" aria-label="Réglages">
              {TABS.map((t) => (
                <button key={t.key} role="tab" aria-selected={tab === t.key} className={"gpx-share-tab" + (tab === t.key ? " active" : "")} onClick={() => setTab(t.key)}>{t.label}</button>
              ))}
            </div>

            <div className="gpx-share-panel" role="tabpanel">
              {tab === "style" && (
                <>
                  <FormatPicker format={format} onChange={(v) => set("format", v)} />

                  <fieldset className="gpx-share-group">
                    <legend>Mise en page</legend>
                    <div className="gpx-share-cards" role="radiogroup" aria-label="Mise en page">
                      {SHARE_STYLES.map((o) => (
                        <button key={o.key} role="radio" aria-checked={prefs.style === o.key} className={"gpx-share-opt" + (prefs.style === o.key ? " active" : "")} onClick={() => set("style", o.key)}>
                          <strong>{o.label}</strong><small>{o.hint}</small>
                        </button>
                      ))}
                    </div>
                  </fieldset>

                  <BackgroundPicker theme={theme} onChange={setTheme} />
                </>
              )}

              {tab === "text" && (
                <>
                  <FontPicker font={prefs.font} onChange={(v) => set("font", v)} />
                  <Slider id="gpx-share-textscale" label="Taille du texte" spec={SHARE_ADJUST.textScale} value={prefs.textScale} onChange={(v) => set("textScale", v)} format={(v) => `${Math.round(v * 100)} %`} />
                  <fieldset className="gpx-share-group">
                    <legend>Chiffres affichés</legend>
                    <div className="gpx-share-checks">
                      {HIDEABLE_STATS.map((s) => (
                        <label key={s.key} className="gpx-check">
                          <input type="checkbox" checked={!prefs.hidden.includes(s.key)} onChange={() => toggle("hidden", s.key)} /> {s.label}
                        </label>
                      ))}
                      {EXTRA_STATS.map((s) => (
                        <label key={s.key} className="gpx-check">
                          <input type="checkbox" checked={prefs.extra.includes(s.key)} onChange={() => toggle("extra", s.key)} /> {s.label}
                        </label>
                      ))}
                    </div>
                    <p className="gpx-share-hint">Les chiffres supplémentaires n'apparaissent que si la sortie les contient (capteurs).</p>
                  </fieldset>
                </>
              )}

              {tab === "route" && (
                <>
                  <AccentPicker accent={prefs.accent} onChange={(v) => set("accent", v)} legend="Couleur du tracé" />
                  <Slider id="gpx-share-routewidth" label="Épaisseur" spec={SHARE_ADJUST.routeWidth} value={prefs.routeWidth} onChange={(v) => set("routeWidth", v)} format={(v) => `${v} px`} />
                  <Slider id="gpx-share-routescale" label="Taille du tracé" spec={SHARE_ADJUST.routeScale} value={prefs.routeScale} onChange={(v) => set("routeScale", v)} format={(v) => `${Math.round(v * 100)} %`} />
                  <Slider id="gpx-share-routex" label="Position horizontale" spec={SHARE_ADJUST.routeX} value={prefs.routeX} onChange={(v) => set("routeX", v)} />
                  <Slider id="gpx-share-routey" label="Position verticale" spec={SHARE_ADJUST.routeY} value={prefs.routeY} onChange={(v) => set("routeY", v)} />
                </>
              )}

              {tab === "parts" && (
                <>
                  <fieldset className="gpx-share-group">
                    <legend>Éléments affichés</legend>
                    <div className="gpx-share-checks">
                      {SHARE_PARTS.map((p) => (
                        <label key={p.key} className="gpx-check">
                          <input type="checkbox" checked={!prefs.hiddenParts.includes(p.key)} onChange={() => toggle("hiddenParts", p.key)} /> {p.label}
                        </label>
                      ))}
                    </div>
                  </fieldset>
                  <fieldset className="gpx-share-group">
                    <legend><ShieldCheck size={13} /> Confidentialité</legend>
                    <label className="gpx-check">
                      <input type="checkbox" checked={prefs.hidePlaces} onChange={(e) => set("hidePlaces", e.target.checked)} /> Masquer départ et arrivée
                    </label>
                    <label className="gpx-check">
                      <input type="checkbox" checked={prefs.simplify} onChange={(e) => set("simplify", e.target.checked)} /> Simplifier le tracé
                    </label>
                    <p className="gpx-share-hint">L'image ne contient ni coordonnées GPS, ni fichier de sortie. {prefs.hidePlaces ? "Les 300 premiers et derniers mètres sont retirés." : "Le départ et l'arrivée sont visibles."}</p>
                  </fieldset>
                </>
              )}
            </div>

            <button className="gpx-link-btn gpx-share-reset" onClick={() => { setPrefs({ ...DEFAULTS }); setTheme(systemScheme); }}>
              <RotateCcw size={13} aria-hidden="true" /> Réinitialiser les réglages
            </button>

            {!hasRoute && <p className="gpx-share-hint">Cette sortie n'a pas de tracé GPS exploitable : la carte affichera un état de remplacement.</p>}
            {message && <div className={message.type === "error" ? "gpx-error-box" : "gpx-share-ok"} role={message.type === "error" ? "alert" : "status"}>{message.text}</div>}

            <div className="gpx-share-actions">
              <button className="gpx-btn-primary" onClick={() => run(false)} disabled={busy}>
                <Download size={16} /> <span>{busy ? "Création…" : `Télécharger PNG (${f.width}×${f.height})`}</span>
              </button>
              {canNativeShare && (
                <button className="gpx-btn-ghost" onClick={() => run(true)} disabled={busy}>
                  <Share2 size={15} /> <span>Partager</span>
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

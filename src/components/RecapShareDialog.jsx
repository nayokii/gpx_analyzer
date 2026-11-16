/**
 * Dialogue « Partager mon récap » : aperçu de l'image de la semaine / du mois / de l'année et réglages (format, fond,
 * police, couleur, chiffre vedette, taille du texte, éléments). Même moteur que le partage d'une sortie ; les
 * réglages sont mémorisés séparément sur l'appareil.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { X, Download, Share2, RotateCcw } from "lucide-react";

import { Slider, FormatPicker, BackgroundPicker, FontPicker, AccentPicker } from "./ShareControls.jsx";
import { useColorScheme } from "../lib/theme.js";
import { SHARE_FORMATS, SHARE_ADJUST, shareOrDownload, downloadBlob } from "../lib/feed/shareCard.js";
import { buildRecapModel, renderRecapCard, exportRecapPng, recapFileName, RECAP_METRICS, RECAP_PARTS } from "../lib/progress/recapCard.js";

const STORAGE_KEY = "cycling-os-recap-prefs";
const DEFAULTS = { format: "story", font: "system", accent: null, metric: "distance", hiddenParts: [], textScale: SHARE_ADJUST.textScale.def };

function loadPrefs() {
  try {
    const raw = JSON.parse(window.localStorage.getItem(STORAGE_KEY) || "null");
    if (!raw || typeof raw !== "object") return {};
    const out = {};
    for (const k of Object.keys(DEFAULTS)) {
      if (k === "accent" ? raw[k] === null || typeof raw[k] === "string" : k in raw && typeof raw[k] === typeof DEFAULTS[k]) out[k] = raw[k];
    }
    return out;
  } catch {
    return {};
  }
}

function RecapCanvas({ model }) {
  const ref = useRef(null);
  useEffect(() => { if (ref.current) renderRecapCard(ref.current, model); }, [model]);
  return (
    <canvas ref={ref} className="gpx-share-canvas" width={model.width} height={model.height} style={{ aspectRatio: `${model.width} / ${model.height}` }}
      role="img" aria-label={`Aperçu récap ${model.format === "story" ? "story" : model.format === "square" ? "carré" : "sticker"} : ${model.title}`} />
  );
}

/**
 * @param {Object} props
 * @param {Array} props.activities - résumés de sorties (déjà filtrés par type)
 * @param {'week'|'month'|'year'} props.kind
 * @param {Date} props.start - début de la période
 * @param {string} [props.sportLabel]
 */
export function RecapShareDialog({ activities, kind, start, sportLabel, onClose }) {
  const systemScheme = useColorScheme();
  const [prefs, setPrefs] = useState(() => ({ ...DEFAULTS, ...loadPrefs() }));
  const [theme, setTheme] = useState(systemScheme);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(null);
  const closeRef = useRef(null);

  useEffect(() => { try { window.localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs)); } catch { /* réglages non mémorisés */ } }, [prefs]);
  useEffect(() => {
    closeRef.current && closeRef.current.focus();
    const onKey = (e) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const set = (key, value) => setPrefs((p) => ({ ...p, [key]: value }));
  const togglePart = (key) => setPrefs((p) => ({ ...p, hiddenParts: p.hiddenParts.includes(key) ? p.hiddenParts.filter((k) => k !== key) : [...p.hiddenParts, key] }));
  const partsKey = prefs.hiddenParts.join(",");
  const model = useMemo(
    () => buildRecapModel(activities, { kind, start, sportLabel, theme, ...prefs }),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- hiddenParts est recréé à chaque rendu : sa clé texte suffit
    [activities, kind, start.getTime(), sportLabel, theme, prefs.format, prefs.font, prefs.accent, prefs.metric, partsKey, prefs.textScale]
  );
  const canNativeShare = typeof navigator !== "undefined" && typeof navigator.share === "function";
  const f = SHARE_FORMATS[prefs.format];

  async function run(native) {
    setBusy(true);
    setMessage(null);
    try {
      const blob = await exportRecapPng(model);
      const fileName = recapFileName(kind, start, prefs.format, theme);
      if (native) {
        const outcome = await shareOrDownload(blob, fileName);
        if (outcome === "downloaded") setMessage({ type: "ok", text: "Partage natif indisponible : l'image a été téléchargée." });
        else if (outcome === "shared") setMessage({ type: "ok", text: "Image partagée." });
      } else {
        downloadBlob(blob, fileName);
        setMessage({ type: "ok", text: `Image ${f.width} × ${f.height} téléchargée.` });
      }
    } catch (err) {
      setMessage({ type: "error", text: err.message || "L'export a échoué." });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="gpx-share-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="gpx-share-dialog" role="dialog" aria-modal="true" aria-labelledby="gpx-recap-title">
        <div className="gpx-share-head">
          <h2 id="gpx-recap-title">Partager mon récap</h2>
          <button ref={closeRef} className="gpx-icon-btn" onClick={onClose} aria-label="Fermer"><X size={18} /></button>
        </div>
        <div className="gpx-share-body">
          <div className={"gpx-share-preview gpx-share-preview--" + prefs.format + (theme === "transparent" ? " gpx-share-preview--transparent" : "")}>
            <RecapCanvas model={model} />
          </div>

          <div className="gpx-share-controls">
            <div className="gpx-share-panel gpx-share-panel--scroll">
              <FormatPicker format={prefs.format} onChange={(v) => set("format", v)} />

              <fieldset className="gpx-share-group">
                <legend>Chiffre vedette</legend>
                <div className="gpx-seg" role="radiogroup" aria-label="Chiffre vedette">
                  {RECAP_METRICS.map((o) => (
                    <button key={o.key} role="radio" aria-checked={prefs.metric === o.key} className={"gpx-seg-btn" + (prefs.metric === o.key ? " active" : "")} onClick={() => set("metric", o.key)}>{o.label}</button>
                  ))}
                </div>
              </fieldset>

              <BackgroundPicker theme={theme} onChange={setTheme} />
              <FontPicker font={prefs.font} onChange={(v) => set("font", v)} />
              <AccentPicker accent={prefs.accent} onChange={(v) => set("accent", v)} />
              <Slider id="gpx-recap-textscale" label="Taille du texte" spec={SHARE_ADJUST.textScale} value={prefs.textScale} onChange={(v) => set("textScale", v)} format={(v) => `${Math.round(v * 100)} %`} />

              <fieldset className="gpx-share-group">
                <legend>Éléments affichés</legend>
                <div className="gpx-share-checks">
                  {RECAP_PARTS.map((p) => (
                    <label key={p.key} className="gpx-check">
                      <input type="checkbox" checked={!prefs.hiddenParts.includes(p.key)} onChange={() => togglePart(p.key)} /> {p.label}
                    </label>
                  ))}
                </div>
                <p className="gpx-share-hint">L'image ne contient que des totaux : ni tracé, ni lieu, ni nom de sortie.</p>
              </fieldset>
            </div>

            <button className="gpx-link-btn gpx-share-reset" onClick={() => { setPrefs({ ...DEFAULTS }); setTheme(systemScheme); }}>
              <RotateCcw size={13} aria-hidden="true" /> Réinitialiser les réglages
            </button>
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

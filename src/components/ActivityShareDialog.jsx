/**
 * Boîte de dialogue « Partager » : aperçu avant export, choix du format
 * (Story / Carré), du thème, des chiffres affichés et des options de
 * confidentialité, puis téléchargement PNG ou partage natif.
 */
import { useEffect, useRef, useState } from "react";
import { X, Download, Share2, ShieldCheck } from "lucide-react";

import { ActivityShareCard } from "./ActivityShareCard.jsx";
import { useColorScheme } from "../lib/theme.js";
import {
  SHARE_FORMATS, SHARE_BACKGROUNDS, HIDEABLE_STATS, buildShareModel, exportShareCardPng, shareFileName, shareOrDownload, downloadBlob,
} from "../lib/feed/shareCard.js";
import { extractRoute } from "../lib/feed/feedModel.js";

export function ActivityShareDialog({ activity, name, onClose }) {
  const systemScheme = useColorScheme();
  const [format, setFormat] = useState("story");
  const [theme, setTheme] = useState(systemScheme);
  const [hidden, setHidden] = useState([]);
  const [hidePlaces, setHidePlaces] = useState(true);
  const [simplify, setSimplify] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(null);
  const closeRef = useRef(null);

  useEffect(() => {
    closeRef.current && closeRef.current.focus();
    const onKey = (e) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const canNativeShare = typeof navigator !== "undefined" && typeof navigator.share === "function";
  const hasRoute = !!extractRoute(activity);

  function toggleHidden(key) {
    setHidden((h) => (h.includes(key) ? h.filter((k) => k !== key) : [...h, key]));
  }

  async function run(native) {
    setBusy(true);
    setMessage(null);
    try {
      const blob = await exportShareCardPng(buildShareModel(activity, { name, format, theme, hidden, hidePlaces, simplify }));
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
            <ActivityShareCard activity={activity} name={name} format={format} theme={theme} hidden={hidden} hidePlaces={hidePlaces} simplify={simplify} />
          </div>

          <div className="gpx-share-controls">
            <fieldset className="gpx-share-group">
              <legend>Format</legend>
              <div className="gpx-seg" role="radiogroup" aria-label="Format de l'image">
                {Object.values(SHARE_FORMATS).map((o) => (
                  <button key={o.key} role="radio" aria-checked={format === o.key} className={"gpx-seg-btn" + (format === o.key ? " active" : "")} onClick={() => setFormat(o.key)}>
                    {o.label}<small>{o.width}×{o.height}</small>
                  </button>
                ))}
              </div>
            </fieldset>

            <fieldset className="gpx-share-group">
              <legend>Fond</legend>
              <div className="gpx-seg" role="radiogroup" aria-label="Fond de l'image">
                {SHARE_BACKGROUNDS.map((o) => (
                  <button key={o.key} role="radio" aria-checked={theme === o.key} className={"gpx-seg-btn" + (theme === o.key ? " active" : "")} onClick={() => setTheme(o.key)}>{o.label}</button>
                ))}
              </div>
              {theme === "transparent" && (
                <p className="gpx-share-hint">PNG avec canal alpha : le damier n'est qu'un repère d'aperçu, il n'est pas dans l'image. Textes et tracé sont clairs avec un fin contour sombre pour rester lisibles sur une photo. Le format « Sticker » est plus compact pour une story.</p>
              )}
            </fieldset>

            <fieldset className="gpx-share-group">
              <legend>Chiffres affichés</legend>
              <div className="gpx-share-checks">
                {HIDEABLE_STATS.map((s) => (
                  <label key={s.key} className="gpx-check">
                    <input type="checkbox" checked={!hidden.includes(s.key)} onChange={() => toggleHidden(s.key)} /> {s.label}
                  </label>
                ))}
              </div>
            </fieldset>

            <fieldset className="gpx-share-group">
              <legend><ShieldCheck size={13} /> Confidentialité</legend>
              <label className="gpx-check">
                <input type="checkbox" checked={hidePlaces} onChange={(e) => setHidePlaces(e.target.checked)} /> Masquer départ et arrivée
              </label>
              <label className="gpx-check">
                <input type="checkbox" checked={simplify} onChange={(e) => setSimplify(e.target.checked)} /> Simplifier le tracé
              </label>
              <p className="gpx-share-hint">L'image ne contient ni coordonnées GPS, ni fichier de sortie. {hidePlaces ? "Les 300 premiers et derniers mètres sont retirés." : "Le départ et l'arrivée sont visibles."}</p>
            </fieldset>

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

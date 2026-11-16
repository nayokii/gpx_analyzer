/**
 * Contrôles communs aux dialogues de partage (sortie et récap) : format, fond, police, couleur d'accent, curseur.
 * Même balisage et mêmes libellés accessibles dans les deux dialogues.
 */
import { SHARE_FORMATS, SHARE_BACKGROUNDS, SHARE_FONTS, SHARE_ACCENTS, SHARE_THEMES } from "../lib/feed/shareCard.js";

export const DEFAULT_ACCENT = "#D6116B";

export function Slider({ id, label, spec, value, onChange, format = (v) => String(v) }) {
  return (
    <label className="gpx-share-slider" htmlFor={id}>
      <span>{label}<b>{format(value)}</b></span>
      <input id={id} type="range" min={spec.min} max={spec.max} step={spec.step} value={value} onChange={(e) => onChange(Number(e.target.value))} />
    </label>
  );
}

export function FormatPicker({ format, onChange }) {
  return (
    <fieldset className="gpx-share-group">
      <legend>Format</legend>
      <div className="gpx-seg" role="radiogroup" aria-label="Format de l'image">
        {Object.values(SHARE_FORMATS).map((o) => (
          <button key={o.key} role="radio" aria-checked={format === o.key} className={"gpx-seg-btn" + (format === o.key ? " active" : "")} onClick={() => onChange(o.key)}>
            {o.label}<small>{o.width}×{o.height}</small>
          </button>
        ))}
      </div>
    </fieldset>
  );
}

export function BackgroundPicker({ theme, onChange }) {
  return (
    <fieldset className="gpx-share-group">
      <legend>Fond</legend>
      <div className="gpx-share-swatches" role="radiogroup" aria-label="Fond de l'image">
        {SHARE_BACKGROUNDS.map((o) => {
          const th = SHARE_THEMES[o.key];
          const bg = th.bg0 ? `linear-gradient(160deg, ${th.bg0}, ${th.bg1})` : undefined;
          return (
            <button key={o.key} role="radio" aria-checked={theme === o.key} aria-label={o.label} title={o.label}
              className={"gpx-share-swatch" + (theme === o.key ? " active" : "") + (o.key === "transparent" ? " is-checker" : "")} style={bg ? { background: bg } : undefined} onClick={() => onChange(o.key)}>
              <span>{o.label}</span>
            </button>
          );
        })}
      </div>
      {theme === "transparent" && (
        <p className="gpx-share-hint">PNG avec canal alpha : le damier n'est qu'un repère d'aperçu, il n'est pas dans l'image. Textes et tracé sont clairs avec un fin contour sombre pour rester lisibles sur une photo. Le format « Sticker » est plus compact pour une story.</p>
      )}
    </fieldset>
  );
}

export function FontPicker({ font, onChange }) {
  return (
    <fieldset className="gpx-share-group">
      <legend>Police</legend>
      <div className="gpx-share-fonts" role="radiogroup" aria-label="Police">
        {SHARE_FONTS.map((o) => (
          <button key={o.key} role="radio" aria-checked={font === o.key} className={"gpx-share-font" + (font === o.key ? " active" : "")} style={{ fontFamily: o.stack }} onClick={() => onChange(o.key)}>
            <span>Aa</span><small>{o.label}</small>
          </button>
        ))}
      </div>
    </fieldset>
  );
}

/** `accent` : hexadécimal choisi, ou null pour le rose Cycling OS. */
export function AccentPicker({ accent, onChange, legend = "Couleur d'accent" }) {
  const value = accent || DEFAULT_ACCENT;
  const same = (c) => value.toLowerCase() === c.toLowerCase();
  return (
    <fieldset className="gpx-share-group">
      <legend>{legend}</legend>
      <div className="gpx-share-accents" role="radiogroup" aria-label={legend}>
        {SHARE_ACCENTS.map((c) => (
          <button key={c} role="radio" aria-checked={same(c)} aria-label={c} className={"gpx-share-accent" + (same(c) ? " active" : "")} style={{ background: c }} onClick={() => onChange(c === DEFAULT_ACCENT ? null : c)} />
        ))}
        <label className="gpx-share-accent gpx-share-accent--custom" title="Couleur personnalisée">
          <input type="color" value={value} onChange={(e) => onChange(e.target.value)} aria-label="Couleur personnalisée" />
        </label>
      </div>
    </fieldset>
  );
}

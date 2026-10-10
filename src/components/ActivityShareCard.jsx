/**
 * ActivityShareCard — visuel éditorial d'une sortie (story ou carré), réutilisable.
 *
 * Le canvas affiché EST le canvas d'export : il fait toujours la résolution
 * réelle du format (1080×1920 ou 1080×1080) et n'est réduit que par le CSS
 * pour l'aperçu. L'aperçu et le PNG téléchargé sont donc identiques par
 * construction (voir ../lib/feed/shareCard.js pour le dessin et les limites).
 */
import { useEffect, useMemo, useRef } from "react";
import { buildShareModel, renderShareCard } from "../lib/feed/shareCard.js";

/**
 * @param {Object} props
 * @param {Object} props.activity - Activity complète
 * @param {string} [props.name] - nom affiché
 * @param {'story'|'square'} [props.format]
 * @param {'dark'|'light'} [props.theme]
 * @param {string[]} [props.hidden] - statistiques masquées
 * @param {boolean} [props.hidePlaces]
 * @param {boolean} [props.simplify]
 */
export function ActivityShareCard({ activity, name, format = "story", theme = "dark", hidden = [], hidePlaces = true, simplify = true, className = "" }) {
  const canvasRef = useRef(null);
  const hiddenKey = hidden.join(",");
  const model = useMemo(
    () => buildShareModel(activity, { name, format, theme, hidden, hidePlaces, simplify }),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `hidden` est recréé à chaque rendu parent ; sa clé texte suffit
    [activity, name, format, theme, hiddenKey, hidePlaces, simplify]
  );

  useEffect(() => {
    if (canvasRef.current) renderShareCard(canvasRef.current, model);
  }, [model]);

  const label = `Aperçu ${format === "story" ? "story" : "carré"} : ${model.title}${model.distance ? `, ${model.distance.value} ${model.distance.unit}` : ""}`;
  return (
    <canvas
      ref={canvasRef}
      className={"gpx-share-canvas " + className}
      width={model.width}
      height={model.height}
      style={{ aspectRatio: `${model.width} / ${model.height}` }}
      role="img"
      aria-label={label}
    />
  );
}

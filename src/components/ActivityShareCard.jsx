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
 * @param {'story'|'square'|'sticker'} [props.format]
 * @param {'dark'|'light'|'transparent'} [props.theme] - « transparent » : aucun fond dessiné, PNG avec canal alpha
 * @param {string[]} [props.hidden] - statistiques masquées
 * @param {boolean} [props.hidePlaces]
 * @param {boolean} [props.simplify]
 * @param {Object} [props.custom] - style, font, accent, hiddenParts, extra, textScale, routeScale, routeX, routeY, routeWidth (voir buildShareModel)
 */
export function ActivityShareCard({ activity, name, format = "story", theme = "dark", hidden = [], hidePlaces = true, simplify = true, className = "", ...custom }) {
  const canvasRef = useRef(null);
  // Les listes sont recréées à chaque rendu parent : leur clé texte suffit comme dépendance.
  const listKey = [hidden, custom.hiddenParts || [], custom.extra || []].map((l) => l.join(",")).join("|");
  const { style, font, accent, textScale, routeScale, routeX, routeY, routeWidth } = custom;
  const model = useMemo(
    () => buildShareModel(activity, { name, format, theme, hidden, hidePlaces, simplify, ...custom }),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `custom` est recréé à chaque rendu ; ses champs sont listés un à un
    [activity, name, format, theme, listKey, hidePlaces, simplify, style, font, accent, textScale, routeScale, routeX, routeY, routeWidth]
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

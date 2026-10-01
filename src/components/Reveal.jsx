/**
 * Reveal — apparition d'un GROUPE visuel (opacité + translateY de 3px, une seule fois).
 *
 * Purement CSS (voir .gpx-reveal dans styles/tokens.css) : le wrapper rejoue l'animation
 * uniquement à son montage, donc à une vraie entrée dans la vue (React remonte déjà la vue à
 * chaque navigation). Tant que le wrapper reste monté, aucun rerender, changement de valeur
 * ou de filtre ne la relance : à placer autour de conteneurs STABLES, jamais autour d'une
 * ligne ou d'une cellule individuelle.
 *
 * Aucune dépendance aux données : `delay` est un simple décalage en ms (≤ 40 ms entre groupes
 * voisins). Sous prefers-reduced-motion, l'animation est supprimée (contenu visible d'emblée).
 */
export function Reveal({ delay = 0, className, children }) {
  return (
    <div className={"gpx-reveal" + (className ? " " + className : "")} style={delay ? { "--reveal-delay": delay + "ms" } : undefined}>
      {children}
    </div>
  );
}

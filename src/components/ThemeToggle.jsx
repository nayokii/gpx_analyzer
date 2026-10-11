/**
 * Sélecteur de thème : Système / Clair / Sombre. Présentation seule, branché sur le store global (lib/theme.js) :
 * aucun état local, donc jamais de désaccord avec l'attribut data-theme ni avec les graphiques.
 */
import { Monitor, Sun, Moon } from "lucide-react";
import { useTheme } from "../lib/theme.js";

const OPTIONS = [
  { value: "system", label: "Système", icon: Monitor },
  { value: "light", label: "Clair", icon: Sun },
  { value: "dark", label: "Sombre", icon: Moon },
];

export function ThemeToggle({ className = "" }) {
  const { preference, theme, setPreference } = useTheme();

  function onKeyDown(event) {
    const i = OPTIONS.findIndex((o) => o.value === preference);
    let next = null;
    if (event.key === "ArrowRight" || event.key === "ArrowDown") next = OPTIONS[(i + 1) % OPTIONS.length];
    if (event.key === "ArrowLeft" || event.key === "ArrowUp") next = OPTIONS[(i + OPTIONS.length - 1) % OPTIONS.length];
    if (!next) return;
    event.preventDefault();
    setPreference(next.value);
    const group = event.currentTarget;
    requestAnimationFrame(() => {
      const btn = group.querySelector('[aria-checked="true"]');
      if (btn) btn.focus();
    });
  }

  return (
    <div
      className={"gpx-theme-toggle " + className}
      role="radiogroup"
      aria-label={`Thème de l'interface (actuellement ${theme === "dark" ? "sombre" : "clair"})`}
      onKeyDown={onKeyDown}
    >
      {OPTIONS.map(({ value, label, icon: Icon }) => {
        const checked = preference === value;
        return (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={checked}
            tabIndex={checked ? 0 : -1}
            className={"gpx-theme-option" + (checked ? " is-active" : "")}
            title={label}
            aria-label={label}
            onClick={() => setPreference(value)}
          >
            <Icon size={15} aria-hidden="true" />
          </button>
        );
      })}
    </div>
  );
}

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { useEffect } from "react";
import { render, cleanup, screen, act, fireEvent } from "@testing-library/react";

import {
  THEME_STORAGE_KEY, normalizePreference, resolveTheme, readStoredPreference, setThemePreference, getThemeState,
  useTheme, useColorScheme, __resetThemeForTests,
} from "./theme.js";
import { ThemeToggle } from "../components/ThemeToggle.jsx";

const root = () => document.documentElement;

/** matchMedia contrôlable : `set(true)` simule le passage du système en sombre. */
function mockSystem(initialDark) {
  const listeners = new Set();
  const mql = {
    matches: initialDark,
    addEventListener: (_e, l) => listeners.add(l),
    removeEventListener: (_e, l) => listeners.delete(l),
  };
  window.matchMedia = vi.fn(() => mql);
  return { listeners, set(dark) { mql.matches = dark; listeners.forEach((l) => l({ matches: dark })); } };
}

const realMatchMedia = window.matchMedia;
beforeEach(() => {
  __resetThemeForTests();
  window.localStorage.clear();
  root().removeAttribute("data-theme");
  root().style.colorScheme = "";
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  window.matchMedia = realMatchMedia;
  __resetThemeForTests();
});

describe("préférence : normalisation", () => {
  it("accepte system / light / dark, ramène tout le reste à system", () => {
    for (const ok of ["system", "light", "dark"]) expect(normalizePreference(ok)).toBe(ok);
    for (const bad of [null, undefined, "", "DARK", "cockpit", "purple", 3, {}, []]) expect(normalizePreference(bad)).toBe("system");
  });

  it("resolveTheme : un choix manuel l'emporte, system suit le système", () => {
    expect(resolveTheme("light", true)).toBe("light");
    expect(resolveTheme("dark", false)).toBe("dark");
    expect(resolveTheme("system", true)).toBe("dark");
    expect(resolveTheme("system", false)).toBe("light");
  });
});

describe("premier lancement", () => {
  it("sans préférence enregistrée : mode system, thème du système sombre", () => {
    mockSystem(true);
    expect(getThemeState()).toEqual({ preference: "system", theme: "dark" });
    expect(root().getAttribute("data-theme")).toBe("dark");
    expect(root().style.colorScheme).toBe("dark");
  });

  it("sans préférence enregistrée : thème du système clair", () => {
    mockSystem(false);
    expect(getThemeState()).toEqual({ preference: "system", theme: "light" });
    expect(root().getAttribute("data-theme")).toBe("light");
  });

  it("sans matchMedia (environnement restreint) : clair par défaut, aucune erreur", () => {
    delete window.matchMedia;
    expect(getThemeState()).toEqual({ preference: "system", theme: "light" });
  });

  it("ne crée aucune clé de stockage tant que l'utilisateur n'a rien choisi", () => {
    mockSystem(true);
    getThemeState();
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBeNull();
  });
});

describe("choix manuel et persistance", () => {
  it("choix clair, puis choix sombre, appliqués sur <html> sans rechargement", () => {
    mockSystem(true);
    setThemePreference("light");
    expect(getThemeState()).toEqual({ preference: "light", theme: "light" });
    expect(root().getAttribute("data-theme")).toBe("light");
    setThemePreference("dark");
    expect(getThemeState()).toEqual({ preference: "dark", theme: "dark" });
    expect(root().getAttribute("data-theme")).toBe("dark");
    expect(root().style.colorScheme).toBe("dark");
  });

  it("la préférence survit à un rechargement (nouveau store, même localStorage)", () => {
    mockSystem(false);
    setThemePreference("dark");
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe("dark");
    __resetThemeForTests();
    root().removeAttribute("data-theme");
    expect(readStoredPreference()).toBe("dark");
    expect(getThemeState()).toEqual({ preference: "dark", theme: "dark" });
    expect(root().getAttribute("data-theme")).toBe("dark");
  });

  it("revenir à system persiste et suit de nouveau le système", () => {
    const sys = mockSystem(false);
    setThemePreference("dark");
    setThemePreference("system");
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe("system");
    expect(getThemeState().theme).toBe("light");
    sys.set(true);
    expect(getThemeState().theme).toBe("dark");
  });

  it("s'aligne sur un changement de préférence fait dans un autre onglet", () => {
    mockSystem(false);
    getThemeState();
    window.localStorage.setItem(THEME_STORAGE_KEY, "dark");
    act(() => { window.dispatchEvent(new StorageEvent("storage", { key: THEME_STORAGE_KEY, newValue: "dark" })); });
    expect(getThemeState()).toEqual({ preference: "dark", theme: "dark" });
  });
});

describe("suivi du système", () => {
  it("en mode system, un changement du système met à jour l'attribut et notifie React", () => {
    const sys = mockSystem(false);
    function Probe() { return <span data-testid="theme">{useTheme().theme}</span>; }
    render(<Probe />);
    expect(screen.getByTestId("theme").textContent).toBe("light");
    act(() => sys.set(true));
    expect(screen.getByTestId("theme").textContent).toBe("dark");
    expect(root().getAttribute("data-theme")).toBe("dark");
    act(() => sys.set(false));
    expect(root().getAttribute("data-theme")).toBe("light");
  });

  it("un choix manuel n'est JAMAIS remplacé par le thème du système", () => {
    const sys = mockSystem(false);
    setThemePreference("light");
    act(() => sys.set(true));
    expect(getThemeState()).toEqual({ preference: "light", theme: "light" });
    expect(root().getAttribute("data-theme")).toBe("light");
    setThemePreference("dark");
    act(() => sys.set(false));
    expect(getThemeState()).toEqual({ preference: "dark", theme: "dark" });
  });

  it("libère son écouteur système à la remise à zéro", () => {
    const sys = mockSystem(false);
    getThemeState();
    expect(sys.listeners.size).toBe(1);
    __resetThemeForTests();
    expect(sys.listeners.size).toBe(0);
  });
});

describe("valeurs invalides et stockage inaccessible", () => {
  it("une valeur enregistrée invalide est ignorée (mode system)", () => {
    mockSystem(true);
    window.localStorage.setItem(THEME_STORAGE_KEY, "cockpit");
    expect(getThemeState()).toEqual({ preference: "system", theme: "dark" });
  });

  it("setThemePreference avec une valeur invalide revient à system et n'enregistre jamais la valeur invalide", () => {
    mockSystem(false);
    setThemePreference("dark");
    setThemePreference("n'importe quoi");
    expect(getThemeState()).toEqual({ preference: "system", theme: "light" });
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe("system");
  });

  it("localStorage illisible ET non inscriptible : l'application continue avec le thème du système, le choix tient en mémoire", () => {
    mockSystem(true);
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("SecurityError"); });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("QuotaExceeded"); });
    expect(getThemeState()).toEqual({ preference: "system", theme: "dark" });
    expect(() => setThemePreference("light")).not.toThrow();
    expect(getThemeState()).toEqual({ preference: "light", theme: "light" });
    expect(root().getAttribute("data-theme")).toBe("light");
  });

  it("accès à window.localStorage qui lève une exception (stockage bloqué)", () => {
    mockSystem(false);
    vi.spyOn(window, "localStorage", "get").mockImplementation(() => { throw new Error("blocked"); });
    expect(readStoredPreference()).toBe("system");
    expect(getThemeState().theme).toBe("light");
    expect(() => setThemePreference("dark")).not.toThrow();
    expect(getThemeState().theme).toBe("dark");
  });
});

describe("script précoce d'index.html (aucun flash)", () => {
  const html = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "index.html"), "utf-8");
  const match = /<script>([\s\S]*?)<\/script>/.exec(html);
  const run = (win) => new Function("window", "document", match[1])(win, document);
  const fakeWindow = ({ stored, dark, throwStorage = false, noMatchMedia = false }) => ({
    localStorage: throwStorage ? { getItem() { throw new Error("blocked"); } } : { getItem: () => stored ?? null },
    ...(noMatchMedia ? {} : { matchMedia: () => ({ matches: !!dark }) }),
  });

  it("est inline, placé dans <head> avant tout module (donc avant le premier rendu React)", () => {
    expect(match).toBeTruthy();
    const scriptAt = html.indexOf("<script>");
    expect(scriptAt).toBeGreaterThan(html.indexOf("<head>"));
    expect(scriptAt).toBeLessThan(html.indexOf("</head>"));
    expect(scriptAt).toBeLessThan(html.indexOf('type="module"'));
    expect(match[1]).toContain(THEME_STORAGE_KEY);
  });

  it("applique la même règle que le store pour toutes les combinaisons (préférence × système)", () => {
    for (const stored of [null, "system", "light", "dark", "cockpit", ""]) {
      for (const dark of [false, true]) {
        root().removeAttribute("data-theme");
        run(fakeWindow({ stored, dark }));
        expect(root().getAttribute("data-theme")).toBe(resolveTheme(normalizePreference(stored), dark));
        expect(root().style.colorScheme).toBe(root().getAttribute("data-theme"));
      }
    }
  });

  it("ne lève pas d'erreur si localStorage ou matchMedia sont indisponibles : thème du système, sinon clair", () => {
    root().removeAttribute("data-theme");
    expect(() => run(fakeWindow({ throwStorage: true, dark: true }))).not.toThrow();
    expect(root().getAttribute("data-theme")).toBe("dark");
    root().removeAttribute("data-theme");
    expect(() => run(fakeWindow({ noMatchMedia: true }))).not.toThrow();
    expect(root().getAttribute("data-theme")).toBe("light");
  });

  it("le store reprend ensuite le même thème sans le changer (pas de second clignotement)", () => {
    const sys = mockSystem(true);
    window.localStorage.setItem(THEME_STORAGE_KEY, "light");
    run(window);
    const before = root().getAttribute("data-theme");
    expect(before).toBe("light");
    const mutations = [];
    const observer = new MutationObserver((records) => mutations.push(...records));
    observer.observe(root(), { attributes: true, attributeFilter: ["data-theme"] });
    expect(getThemeState().theme).toBe("light");
    expect(root().getAttribute("data-theme")).toBe(before);
    expect(sys.listeners.size).toBe(1);
    observer.disconnect();
  });
});

describe("compatibilité avec le redessin des graphiques et de la carte", () => {
  it("useColorScheme renvoie le thème EFFECTIF et déclenche un nouveau rendu / effet à chaque changement", () => {
    const sys = mockSystem(false);
    const drawn = [];
    function Chart() {
      const scheme = useColorScheme(); // comme MapView.jsx et ProfileChart.jsx : dépendance de leurs effets de dessin
      useEffect(() => { drawn.push(scheme); }, [scheme]);
      return null;
    }
    render(<Chart />);
    act(() => setThemePreference("dark"));
    act(() => setThemePreference("light"));
    act(() => setThemePreference("system"));
    act(() => sys.set(true));
    expect(drawn).toEqual(["light", "dark", "light", "dark"]);
  });

  it("un même thème effectif ne déclenche pas de redessin inutile (system → clair alors que le système est clair)", () => {
    mockSystem(false);
    const drawn = [];
    function Chart() {
      const scheme = useColorScheme();
      useEffect(() => { drawn.push(scheme); }, [scheme]);
      return null;
    }
    render(<Chart />);
    act(() => setThemePreference("light"));
    expect(drawn).toEqual(["light"]);
  });
});

describe("ThemeToggle", () => {
  it("expose les trois modes, reflète la préférence et la change au clic, sans rechargement", () => {
    mockSystem(false);
    render(<ThemeToggle />);
    const radio = (name) => screen.getByRole("radio", { name });
    expect(radio("Système").getAttribute("aria-checked")).toBe("true");
    fireEvent.click(radio("Sombre"));
    expect(radio("Sombre").getAttribute("aria-checked")).toBe("true");
    expect(radio("Système").getAttribute("aria-checked")).toBe("false");
    expect(root().getAttribute("data-theme")).toBe("dark");
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe("dark");
    fireEvent.click(radio("Clair"));
    expect(root().getAttribute("data-theme")).toBe("light");
  });

  it("se pilote au clavier (flèches) et n'a qu'un seul arrêt de tabulation", () => {
    mockSystem(false);
    render(<ThemeToggle />);
    const group = screen.getByRole("radiogroup");
    expect(screen.getAllByRole("radio").filter((r) => r.tabIndex === 0)).toHaveLength(1);
    fireEvent.keyDown(group, { key: "ArrowRight" });
    expect(screen.getByRole("radio", { name: "Clair" }).getAttribute("aria-checked")).toBe("true");
    fireEvent.keyDown(group, { key: "ArrowLeft" });
    expect(screen.getByRole("radio", { name: "Système" }).getAttribute("aria-checked")).toBe("true");
  });

  it("se met à jour quand le thème change ailleurs (aucun état local)", () => {
    mockSystem(false);
    render(<ThemeToggle />);
    act(() => setThemePreference("dark"));
    expect(screen.getByRole("radio", { name: "Sombre" }).getAttribute("aria-checked")).toBe("true");
  });
});

import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, cleanup, screen, fireEvent, within } from "@testing-library/react";

import { AppShell, buildCrumbs } from "./AppShell.jsx";
import { setThemePreference, __resetThemeForTests } from "../lib/theme.js";

beforeEach(() => { __resetThemeForTests(); window.localStorage.clear(); });
afterEach(() => { cleanup(); __resetThemeForTests(); });

const shell = (props = {}) => render(
  <AppShell active="home" onNavigate={() => {}} onImport={() => {}} {...props}>
    <h1>Contenu de page</h1>
  </AppShell>
);

describe("AppShell : structure", () => {
  it("rend une seule navigation de bureau, la barre basse mobile, un en-tête et la zone de contenu", () => {
    shell();
    expect(screen.getAllByRole("navigation", { name: "Navigation principale" })).toHaveLength(1);
    expect(screen.getByRole("navigation", { name: /mobile/ })).toBeTruthy();
    expect(screen.getByRole("banner")).toBeTruthy();
    expect(screen.getByRole("main").id).toBe("gpx-main");
    expect(within(screen.getByRole("main")).getByRole("heading", { name: "Contenu de page", level: 1 })).toBeTruthy();
  });

  it("n'a plus ni ancienne barre haute ni bande contextuelle", () => {
    shell({ rideContext: { name: "X" } });
    for (const sel of [".gpx-topbar", ".gpx-appnav-top", ".gpx-context-strip", ".gpx-app--cockpit"]) expect(document.querySelector(sel)).toBeNull();
  });

  it("propose un lien d'évitement vers le contenu", () => {
    shell();
    const skip = screen.getByRole("link", { name: "Aller au contenu" });
    expect(skip.getAttribute("href")).toBe("#gpx-main");
  });

  it("ne duplique ni le sélecteur de thème ni l'import", () => {
    shell();
    expect(screen.getAllByRole("radiogroup")).toHaveLength(1);
    expect(screen.getAllByRole("button", { name: "Importer une sortie" })).toHaveLength(1);
  });
});

describe("AppShell : fil d'Ariane et page active", () => {
  it.each([
    ["home", ["Pilotage", "Dashboard"]],
    ["rides", ["Pilotage", "Mes sorties"]],
    ["coach", ["Analyses", "Coach"]],
    ["alterego", ["Progression", "Alter Ego"]],
    ["sources", ["Système", "Sources de données"]],
  ])("page %s", (active, labels) => {
    shell({ active });
    const crumbs = screen.getByRole("navigation", { name: "Fil d'Ariane" });
    expect(within(crumbs).getAllByRole("listitem").map((li) => li.textContent)).toEqual(labels);
    expect(within(crumbs).getByText(labels[1]).getAttribute("aria-current")).toBe("page");
  });

  it("la page active de la navigation correspond au fil d'Ariane", () => {
    shell({ active: "profil" });
    const sidebar = document.querySelector(".gpx-sidebar");
    expect(within(sidebar).getByRole("button", { name: "Profil" }).getAttribute("aria-current")).toBe("page");
    expect(within(sidebar).getByRole("button", { name: "Dashboard" }).getAttribute("aria-current")).toBeNull();
  });

  it("sortie ouverte : « Mes sorties › Analyse — nom », Mes sorties actif et lien de retour fonctionnel", () => {
    const onNavigate = vi.fn();
    shell({ active: "rides", rideContext: { name: "Boucle du dimanche" }, onNavigate });
    const crumbs = screen.getByRole("navigation", { name: "Fil d'Ariane" });
    expect(within(crumbs).getByText("Analyse — Boucle du dimanche").getAttribute("aria-current")).toBe("page");
    fireEvent.click(within(crumbs).getByRole("button", { name: "Mes sorties" }));
    expect(onNavigate).toHaveBeenCalledWith("rides");
    expect(within(document.querySelector(".gpx-sidebar")).getByRole("button", { name: "Mes sorties" }).getAttribute("aria-current")).toBe("page");
  });

  it("buildCrumbs : nom de sortie absent → « Sortie vélo », clé inconnue → aucun fil", () => {
    expect(buildCrumbs("rides", { name: null }, () => {})[1].label).toBe("Analyse — Sortie vélo");
    expect(buildCrumbs("recovery", null, () => {})).toEqual([]);
  });
});

describe("AppShell : actions, import et thème", () => {
  it("l'import appelle onImport", () => {
    const onImport = vi.fn();
    shell({ onImport });
    fireEvent.click(screen.getByRole("button", { name: "Importer une sortie" }));
    expect(onImport).toHaveBeenCalledTimes(1);
  });

  it("affiche les actions contextuelles fournies par la page", () => {
    shell({ actions: <button type="button">Exporter</button> });
    expect(within(screen.getByRole("banner")).getByRole("button", { name: "Exporter" })).toBeTruthy();
  });

  it("le sélecteur de thème fonctionne depuis l'en-tête", () => {
    shell();
    fireEvent.click(within(screen.getByRole("banner")).getByRole("radio", { name: "Sombre" }));
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
  });

  it("changer de page ne réinitialise pas le thème", () => {
    const { rerender } = shell({ active: "home" });
    setThemePreference("dark");
    for (const active of ["rides", "profil", "alterego", "sources", "home"]) {
      rerender(<AppShell active={active} onNavigate={() => {}} onImport={() => {}}><h1>{active}</h1></AppShell>);
      expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
      expect(screen.getByRole("radio", { name: "Sombre" }).getAttribute("aria-checked")).toBe("true");
    }
  });
});

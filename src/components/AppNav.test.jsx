import { describe, it, expect, afterEach, vi } from "vitest";
import { render, cleanup, screen, fireEvent, within } from "@testing-library/react";
import { AppNav, NAV_ITEMS } from "./AppNav.jsx";

afterEach(cleanup);

describe("AppNav — 5 destinations principales", () => {
  it("expose exactement les 5 destinations attendues", () => {
    expect(NAV_ITEMS.map((i) => i.key)).toEqual(["home", "rides", "profil", "alterego", "archetype"]);
  });

  it("rend chaque destination deux fois (barre haute desktop + barre basse mobile) — le choix de layout est purement CSS, jamais deux jeux de données", () => {
    render(<AppNav active="home" onNavigate={() => {}} onImport={() => {}} />);
    for (const item of NAV_ITEMS) {
      expect(screen.getAllByText(item.label).length).toBe(2);
    }
  });

  it("marque la section active sur les deux barres", () => {
    render(<AppNav active="profil" onNavigate={() => {}} onImport={() => {}} />);
    const buttons = screen.getAllByText("Profil").map((el) => el.closest(".gpx-appnav-item"));
    expect(buttons.every((b) => b.className.includes("active"))).toBe(true);
    const others = screen.getAllByText("Accueil").map((el) => el.closest(".gpx-appnav-item"));
    expect(others.every((b) => !b.className.includes("active"))).toBe(true);
  });
});

describe("AppNav — navigation", () => {
  it("appelle onNavigate avec la bonne clé au clic sur chaque destination", () => {
    const onNavigate = vi.fn();
    render(<AppNav active="home" onNavigate={onNavigate} onImport={() => {}} />);
    fireEvent.click(screen.getAllByText("Sorties")[0]);
    expect(onNavigate).toHaveBeenCalledWith("rides");
    fireEvent.click(screen.getAllByText("Alter Ego")[0]);
    expect(onNavigate).toHaveBeenCalledWith("alterego");
    fireEvent.click(screen.getAllByText("Archétype")[0]);
    expect(onNavigate).toHaveBeenCalledWith("archetype");
  });

  it("le clic sur la marque ramène à l'accueil", () => {
    const onNavigate = vi.fn();
    render(<AppNav active="profil" onNavigate={onNavigate} onImport={() => {}} />);
    fireEvent.click(document.querySelector(".gpx-topbar-brand"));
    expect(onNavigate).toHaveBeenCalledWith("home");
  });

  it("chaque item de nav porte un title (accessibilité en affichage icône seule, voir GPXAnalyzer.jsx: variante tablette)", () => {
    render(<AppNav active="home" onNavigate={() => {}} onImport={() => {}} />);
    expect(screen.getAllByTitle("Profil").length).toBe(2);
  });
});

describe("AppNav — import toujours accessible", () => {
  it("le bouton Importer appelle onImport, indépendamment de la section active", () => {
    const onImport = vi.fn();
    render(<AppNav active="archetype" onNavigate={() => {}} onImport={onImport} />);
    fireEvent.click(screen.getByText("Importer"));
    expect(onImport).toHaveBeenCalled();
  });
});

import { describe, it, expect, afterEach, vi } from "vitest";
import { render, cleanup, screen, fireEvent, within } from "@testing-library/react";
import { AppNav, NAV_ITEMS, SIDEBAR_GROUPS } from "./AppNav.jsx";

afterEach(cleanup);

describe("AppNav — 8 destinations principales", () => {
  it("expose exactement les 8 destinations attendues (Historique « rides » conservé)", () => {
    expect(NAV_ITEMS.map((i) => i.key)).toEqual(["home", "rides", "feed", "coach", "profil", "alterego", "archetype", "tour"]);
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
    fireEvent.click(screen.getAllByText("Tour")[0]);
    expect(onNavigate).toHaveBeenCalledWith("tour");
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

describe("AppNav — variante barre latérale (cockpit)", () => {
  const sidebarKeys = SIDEBAR_GROUPS.flatMap((g) => g.items.map((i) => i.key));

  it("ne propose que des destinations réelles : toutes celles de NAV_ITEMS + les sources de données", () => {
    expect([...sidebarKeys].sort()).toEqual([...NAV_ITEMS.map((i) => i.key), "sources"].sort());
  });

  it("rend la barre latérale et la barre basse mobile, sans barre haute desktop", () => {
    render(<AppNav variant="sidebar" active="home" onNavigate={() => {}} onImport={() => {}} />);
    expect(document.querySelector(".gpx-sidebar")).toBeTruthy();
    expect(document.querySelector(".gpx-appnav-bottom")).toBeTruthy();
    expect(document.querySelector(".gpx-appnav-top")).toBeNull();
  });

  it("marque la section active avec aria-current et appelle onNavigate avec la bonne clé", () => {
    const onNavigate = vi.fn();
    render(<AppNav variant="sidebar" active="alterego" onNavigate={onNavigate} onImport={() => {}} />);
    const sidebar = document.querySelector(".gpx-sidebar");
    expect(within(sidebar).getByTitle("Alter Ego").getAttribute("aria-current")).toBe("page");
    expect(sidebar.querySelector(".gpx-sidebar-item[title='Dashboard']").getAttribute("aria-current")).toBeNull();
    fireEvent.click(within(sidebar).getByTitle("Mes sorties"));
    expect(onNavigate).toHaveBeenCalledWith("rides");
    fireEvent.click(within(sidebar).getByTitle("Sources de données"));
    expect(onNavigate).toHaveBeenCalledWith("sources");
  });

  it("le bouton Importer de la barre latérale appelle onImport", () => {
    const onImport = vi.fn();
    render(<AppNav variant="sidebar" active="home" onNavigate={() => {}} onImport={onImport} />);
    fireEvent.click(within(document.querySelector(".gpx-sidebar")).getByTitle("Importer une sortie"));
    expect(onImport).toHaveBeenCalled();
  });
});

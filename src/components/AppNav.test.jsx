import { describe, it, expect, afterEach, vi } from "vitest";
import { render, cleanup, screen, fireEvent, within } from "@testing-library/react";
import { NAV_GROUPS, NAV_ITEMS, MOBILE_PRIMARY_KEYS, SidebarNav, BottomNav, findNavItem, findNavGroup } from "./AppNav.jsx";

afterEach(cleanup);

const ALL_KEYS = NAV_GROUPS.flatMap((g) => g.items.map((i) => i.key));

describe("destinations de navigation", () => {
  it("expose les 8 destinations de contenu existantes (Historique « rides » conservé) + les sources de données", () => {
    expect([...NAV_ITEMS.map((i) => i.key)].sort()).toEqual(["alterego", "archetype", "coach", "feed", "home", "profil", "rides", "tour"]);
    expect([...ALL_KEYS].sort()).toEqual(["alterego", "archetype", "coach", "feed", "home", "profil", "rides", "sources", "tour"]);
  });

  it("regroupe en Pilotage / Analyses / Progression / Système, sans doublon de clé", () => {
    expect(NAV_GROUPS.map((g) => g.label)).toEqual(["Pilotage", "Analyses", "Progression", "Système"]);
    expect(new Set(ALL_KEYS).size).toBe(ALL_KEYS.length);
    expect(findNavGroup("sources").label).toBe("Système");
    expect(findNavItem("rides").label).toBe("Mes sorties");
    expect(findNavItem("inconnue")).toBeNull();
  });

  it("n'a aucune destination factice : pas de page Carte, Objectifs ni Records", () => {
    const labels = NAV_GROUPS.flatMap((g) => g.items.map((i) => i.label));
    for (const fake of ["Carte", "Carte et parcours", "Objectifs", "Records"]) expect(labels).not.toContain(fake);
  });

  it("les destinations prioritaires du mobile existent toutes", () => {
    for (const key of MOBILE_PRIMARY_KEYS) expect(findNavItem(key)).toBeTruthy();
  });
});

describe("SidebarNav", () => {
  it("rend chaque destination une seule fois, par groupes nommés", () => {
    render(<SidebarNav active="home" onNavigate={() => {}} />);
    for (const group of NAV_GROUPS) {
      const region = screen.getByRole("group", { name: group.label });
      for (const item of group.items) expect(within(region).getAllByRole("button", { name: item.label })).toHaveLength(1);
    }
  });

  it("marque la page active avec aria-current, et elle seule", () => {
    render(<SidebarNav active="profil" onNavigate={() => {}} />);
    const current = screen.getAllByRole("button").filter((b) => b.getAttribute("aria-current") === "page");
    expect(current).toHaveLength(1);
    expect(current[0].getAttribute("aria-label")).toBe("Profil");
  });

  it("appelle onNavigate avec la clé de routage existante pour chaque destination", () => {
    const onNavigate = vi.fn();
    render(<SidebarNav active="home" onNavigate={onNavigate} />);
    for (const key of ALL_KEYS) {
      fireEvent.click(screen.getByRole("button", { name: findNavItem(key).label }));
      expect(onNavigate).toHaveBeenLastCalledWith(key);
    }
    expect(onNavigate).toHaveBeenCalledTimes(ALL_KEYS.length);
  });

  it("le clic sur la marque ramène au Dashboard", () => {
    const onNavigate = vi.fn();
    render(<SidebarNav active="profil" onNavigate={onNavigate} />);
    fireEvent.click(screen.getByRole("button", { name: /Cycling OS/ }));
    expect(onNavigate).toHaveBeenCalledWith("home");
  });

  it("clavier : toutes les entrées sont des boutons natifs dans l'ordre de tabulation, avec nom accessible (rail d'icônes inclus)", () => {
    render(<SidebarNav active="home" onNavigate={() => {}} />);
    const buttons = screen.getAllByRole("button");
    expect(buttons).toHaveLength(ALL_KEYS.length + 1); // + marque
    for (const b of buttons) {
      expect(b.tagName).toBe("BUTTON");
      expect(b.tabIndex).toBeGreaterThanOrEqual(0);
      expect(b.getAttribute("aria-label")).toBeTruthy();
    }
  });
});

describe("BottomNav (mobile)", () => {
  it("affiche les destinations prioritaires + « Plus », menu fermé par défaut", () => {
    render(<BottomNav active="home" onNavigate={() => {}} />);
    const nav = screen.getByRole("navigation", { name: /mobile/ });
    expect(within(nav).getAllByRole("button")).toHaveLength(MOBILE_PRIMARY_KEYS.length + 1);
    expect(screen.queryByRole("group", { name: "Autres destinations" })).toBeNull();
    expect(screen.getByRole("button", { name: "Plus de destinations" }).getAttribute("aria-expanded")).toBe("false");
  });

  it("« Plus » ouvre toutes les autres destinations (sources comprises) et naviguer referme le menu", () => {
    const onNavigate = vi.fn();
    render(<BottomNav active="home" onNavigate={onNavigate} />);
    fireEvent.click(screen.getByRole("button", { name: "Plus de destinations" }));
    const menu = screen.getByRole("group", { name: "Autres destinations" });
    const expected = ALL_KEYS.filter((k) => !MOBILE_PRIMARY_KEYS.includes(k)).map((k) => findNavItem(k).label);
    expect(within(menu).getAllByRole("button").map((b) => b.textContent)).toEqual(expected);
    expect(expected).toContain("Sources de données");
    fireEvent.click(within(menu).getByText("Sources de données"));
    expect(onNavigate).toHaveBeenCalledWith("sources");
    expect(screen.queryByRole("group", { name: "Autres destinations" })).toBeNull();
  });

  it("le menu se ferme avec Échap et par un appui à l'extérieur", () => {
    render(<div><BottomNav active="home" onNavigate={() => {}} /><p>ailleurs</p></div>);
    const more = screen.getByRole("button", { name: "Plus de destinations" });
    fireEvent.click(more);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("group", { name: "Autres destinations" })).toBeNull();
    fireEvent.click(more);
    fireEvent.pointerDown(screen.getByText("ailleurs"));
    expect(screen.queryByRole("group", { name: "Autres destinations" })).toBeNull();
  });

  it("marque la destination active, et « Plus » quand la page active est dans le menu", () => {
    const { rerender } = render(<BottomNav active="rides" onNavigate={() => {}} />);
    expect(screen.getByRole("button", { name: "Mes sorties" }).getAttribute("aria-current")).toBe("page");
    expect(screen.getByRole("button", { name: "Plus de destinations" }).className).not.toContain("active");
    rerender(<BottomNav active="profil" onNavigate={() => {}} />);
    expect(screen.getByRole("button", { name: "Plus de destinations" }).className).toContain("active");
  });
});

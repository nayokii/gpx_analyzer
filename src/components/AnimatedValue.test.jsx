import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, cleanup, act } from "@testing-library/react";
import { AnimatedValue } from "./AnimatedValue.jsx";
import { StatCard } from "./UIPrimitives.jsx";
import { Route } from "lucide-react";

// Durée par défaut (aucun token CSS chargé en jsdom) : 250 ms.
const DURATION = 250;

function setReducedMotion(reduced) {
  window.matchMedia = vi.fn().mockImplementation((query) => ({
    matches: reduced && query.includes("prefers-reduced-motion"),
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  }));
}

const text = (container) => container.querySelector(".gpx-av").textContent;
const advance = (ms) => act(() => { vi.advanceTimersByTime(ms); });

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["requestAnimationFrame", "cancelAnimationFrame", "performance", "setTimeout", "clearTimeout"] });
  setReducedMotion(false);
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  delete window.matchMedia;
});

describe("AnimatedValue — premier rendu", () => {
  it("affiche directement la valeur, sans count-up depuis 0", () => {
    const rAF = vi.spyOn(globalThis, "requestAnimationFrame");
    const { container } = render(<AnimatedValue value="31,2" />);
    expect(text(container)).toBe("31,2");
    advance(100);
    expect(text(container)).toBe("31,2");
    expect(rAF).not.toHaveBeenCalled();
  });
});

describe("AnimatedValue — changement de valeur", () => {
  it("interpole puis termine exactement sur la nouvelle valeur (décimal, format conservé)", () => {
    const { container, rerender } = render(<AnimatedValue value="31,2" />);
    rerender(<AnimatedValue value="42,7" />);
    advance(60);
    const mid = text(container);
    expect(mid).not.toBe("31,2");
    expect(mid).not.toBe("42,7");
    expect(mid).toMatch(/^\d{2},\d$/); // toujours 1 décimale, virgule fr-FR
    const v = parseFloat(mid.replace(",", "."));
    expect(v).toBeGreaterThan(31.2);
    expect(v).toBeLessThan(42.7);
    advance(DURATION);
    expect(text(container)).toBe("42,7");
  });

  it("entier : jamais de décimale pendant l'interpolation", () => {
    const { container, rerender } = render(<AnimatedValue value="177" />);
    rerender(<AnimatedValue value="245" />);
    const seen = new Set();
    for (let i = 0; i < 20; i++) {
      advance(16);
      seen.add(text(container));
    }
    for (const s of seen) expect(s).toMatch(/^\d+$/);
    expect(text(container)).toBe("245");
  });

  it("durée composite : 1h19 → 1h32 reste au format XhYY", () => {
    const { container, rerender } = render(<AnimatedValue value="1h19" />);
    rerender(<AnimatedValue value="1h32" />);
    advance(50);
    expect(text(container)).toMatch(/^1h\d{2}$/);
    advance(DURATION);
    expect(text(container)).toBe("1h32");
  });

  it("structure incompatible (— → valeur) : affichage direct", () => {
    const rAF = vi.spyOn(globalThis, "requestAnimationFrame");
    const { container, rerender } = render(<AnimatedValue value="—" />);
    rerender(<AnimatedValue value="18,6" />);
    expect(text(container)).toBe("18,6");
    expect(rAF).not.toHaveBeenCalled();
  });

  it("valeur non numérique / non textuelle : rendue telle quelle", () => {
    const { container } = render(<AnimatedValue value={null} />);
    expect(container.textContent).toBe("");
  });
});

describe("AnimatedValue — même valeur", () => {
  it("un rerender avec exactement la même valeur n'anime rien", () => {
    const { container, rerender } = render(<AnimatedValue value="31,2" />);
    const rAF = vi.spyOn(globalThis, "requestAnimationFrame");
    rerender(<AnimatedValue value="31,2" />);
    rerender(<AnimatedValue value="31,2" />);
    expect(rAF).not.toHaveBeenCalled();
    expect(text(container)).toBe("31,2");
  });

  it("revenir à la valeur déjà affichée après un changement fonctionne", () => {
    const { container, rerender } = render(<AnimatedValue value="10" />);
    rerender(<AnimatedValue value="20" />);
    advance(DURATION + 50);
    rerender(<AnimatedValue value="20" />);
    advance(DURATION + 50);
    expect(text(container)).toBe("20");
  });
});

describe("AnimatedValue — reduced motion", () => {
  it("affiche la nouvelle valeur directement, sans interpolation", () => {
    setReducedMotion(true);
    const rAF = vi.spyOn(globalThis, "requestAnimationFrame");
    const { container, rerender } = render(<AnimatedValue value="31,2" />);
    rerender(<AnimatedValue value="42,7" />);
    expect(text(container)).toBe("42,7");
    expect(rAF).not.toHaveBeenCalled();
  });
});

describe("AnimatedValue — interruption", () => {
  it("une nouvelle valeur en cours d'animation repart de la valeur affichée, pas de 0", () => {
    const { container, rerender } = render(<AnimatedValue value="100" />);
    rerender(<AnimatedValue value="200" />);
    advance(80);
    const before = parseInt(text(container), 10);
    expect(before).toBeGreaterThan(100);
    expect(before).toBeLessThan(200);
    rerender(<AnimatedValue value="50" />);
    const seen = [];
    for (let i = 0; i < 20; i++) {
      advance(16);
      seen.push(parseInt(text(container), 10));
    }
    // jamais de saut vers 0 : toutes les valeurs restent entre la cible et la valeur au moment de l'interruption
    for (const v of seen) {
      expect(v).toBeGreaterThanOrEqual(50);
      expect(v).toBeLessThanOrEqual(before + 1);
    }
    expect(text(container)).toBe("50");
  });
});

describe("AnimatedValue — accessibilité", () => {
  it("n'est pas une zone live : aucune annonce des valeurs intermédiaires", () => {
    const { container, rerender } = render(<AnimatedValue value="31,2" />);
    const el = container.querySelector(".gpx-av");
    expect(el.getAttribute("aria-live")).toBe("off");
    rerender(<AnimatedValue value="42,7" />);
    advance(60);
    expect(container.querySelector(".gpx-av").getAttribute("aria-live")).toBe("off");
  });
});

describe("AnimatedValue — largeur", () => {
  it("réserve la plus grande des deux largeurs pendant l'animation (l'unité voisine ne bouge pas), puis libère", () => {
    // espace fine insécable : séparateur de milliers produit par toLocaleString("fr-FR")
    const { container, rerender } = render(<AnimatedValue value={"1 000"} />);
    rerender(<AnimatedValue value="999" />);
    advance(60);
    expect(container.querySelector(".gpx-av").style.minWidth).toBe("5ch");
    advance(DURATION);
    expect(container.querySelector(".gpx-av").style.minWidth).toBe("");
  });
});

describe("StatCard — intégration", () => {
  it("API inchangée : label, valeur et unité affichés ; null → rien", () => {
    const { container, getByText, rerender } = render(<StatCard icon={Route} label="Distance" value="18,6" unit="km" />);
    expect(getByText("Distance")).toBeTruthy();
    expect(getByText("18,6")).toBeTruthy();
    expect(getByText("km")).toBeTruthy();
    rerender(<StatCard icon={Route} label="Distance" value={null} unit="km" />);
    expect(container.querySelector(".gpx-stat-card")).toBeNull();
  });

  it("une StatCard qui reste montée anime le changement, et l'unité reste inchangée", () => {
    const { container, rerender, getByText } = render(<StatCard icon={Route} label="Distance" value="31,2" unit="km" />);
    rerender(<StatCard icon={Route} label="Distance" value="42,7" unit="km" />);
    advance(60);
    expect(text(container)).not.toBe("31,2");
    expect(getByText("km")).toBeTruthy();
    advance(DURATION);
    expect(text(container)).toBe("42,7");
  });
});

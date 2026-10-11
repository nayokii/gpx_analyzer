import { describe, it, expect, afterEach, vi } from "vitest";
import { render, cleanup, screen, fireEvent, within } from "@testing-library/react";

import { createEmptyActivity } from "../../lib/types.js";
import { stubResizeObserver } from "../testResizeObserverMock.js";
import { stubCanvasContext } from "../testCanvasMock.js";
import { CockpitDashboard } from "./CockpitDashboard.jsx";

stubResizeObserver();
stubCanvasContext();

// Leaflet ne rend pas dans jsdom : carte factice qui expose ce que le cockpit lui transmet.
vi.mock("../MapView.jsx", () => ({
  MapView: ({ decimated, hoverIdx, onHoverIndex, selectedClimb, colorMode }) => (
    <div data-testid="map" data-points={decimated.length} data-hover={hoverIdx ?? ""} data-climb={selectedClimb ? selectedClimb.id : ""} data-mode={colorMode}>
      <button type="button" onClick={() => onHoverIndex(4)}>survol carte</button>
    </div>
  ),
}));

afterEach(cleanup);

const ZONES = [
  { name: "Z1 Récup", min: 0, max: 60, color: "#111111" },
  { name: "Z2 Endurance", min: 60, max: 70, color: "#222222" },
  { name: "Z3 Tempo", min: 70, max: 80, color: "#333333" },
  { name: "Z4 Seuil", min: 80, max: 90, color: "#444444" },
  { name: "Z5 VO2max", min: 90, max: 999, color: "#555555" },
];

/** ~1,1 km, 1 point / 10 s, +5 m par point (montée détectable), capteurs optionnels. */
function makeSamples(n, extra = () => ({})) {
  return Array.from({ length: n }, (_, i) => ({
    timestamp: new Date(Date.UTC(2026, 8, 20, 8, 0, i * 10)).toISOString(),
    latitude: 45 + i * 0.001,
    longitude: 5,
    altitude: 100 + i * 5,
    heartRate: null, cadence: null, power: null, temperature: null, distanceMeasured: null, speedMeasured: null,
    ...extra(i),
  }));
}

function makeActivity(overrides = {}) {
  const base = createEmptyActivity();
  return {
    ...base,
    id: "a1",
    name: "Boucle test",
    date: "2026-09-20T08:00:00.000Z",
    distance: 1.1, duration: 100, movingTime: 95, elevationGain: 50,
    avgSpeed: 24.1, avgSpeedSource: "derived", maxSpeed: 40,
    flags: { ...base.flags, hasGps: true, hasElevation: true, hasTime: true },
    samples: makeSamples(11),
    ...overrides,
  };
}

function fullSensorActivity(overrides = {}) {
  return makeActivity({
    id: "full",
    name: "Sortie capteurs",
    avgHeartRate: 141, maxHeartRate: 168, avgCadence: 86, maxCadence: 110, avgPower: 210, maxPower: 640,
    samples: makeSamples(11, (i) => ({ heartRate: 120 + i * 3, cadence: 80 + i, power: 200 + i })),
    flags: { ...makeActivity().flags, hasHeartRate: true, hasCadence: true, hasPower: true, powerEstimated: false },
    ...overrides,
  });
}

const baseProps = { userSettings: { weight: 75, bikeWeight: 8, ftp: 250, estimatePower: false }, maxHR: 190, hrZones: ZONES };
const panelOf = (name) => screen.getByRole("region", { name });

describe("CockpitDashboard — panneaux", () => {
  it("affiche carte, télémétrie, profil d'altitude, résumé, parcours et analyse", () => {
    render(<CockpitDashboard activities={[fullSensorActivity()]} {...baseProps} onOpenActivity={() => {}} />);
    for (const name of ["Carte du parcours", "Télémétrie", "Profil d'altitude", "Résumé de la sortie", "Séries de la sortie", "Parcours", "Analyse de la sortie"]) {
      expect(panelOf(name)).toBeTruthy();
    }
    expect(screen.getByTestId("map").dataset.points).toBe("11");
  });

  it("le panneau Parcours porte le nom, la distance et le dénivelé de la sortie, et ouvre le détail existant", () => {
    const onOpen = vi.fn();
    render(<CockpitDashboard activities={[fullSensorActivity()]} {...baseProps} onOpenActivity={onOpen} />);
    const route = panelOf("Parcours");
    expect(within(route).getByText("Sortie capteurs")).toBeTruthy();
    expect(within(route).getByText("+50")).toBeTruthy();
    fireEvent.click(within(route).getByText("Voir l'analyse"));
    expect(onOpen).toHaveBeenCalledWith("full");
  });

  it("n'affiche pas le bouton de détail sans handler", () => {
    render(<CockpitDashboard activities={[makeActivity()]} {...baseProps} />);
    expect(screen.queryByText("Voir l'analyse")).toBeNull();
  });
});

describe("CockpitDashboard — télémétrie", () => {
  it("affiche les moyennes de la sortie par défaut, avec leur provenance", () => {
    render(<CockpitDashboard activities={[fullSensorActivity()]} {...baseProps} />);
    const tele = panelOf("Télémétrie");
    expect(within(tele).getByText(/Moyennes de la sortie/)).toBeTruthy();
    expect(within(tele).getByText("141")).toBeTruthy(); // FC moyenne de l'Activity
    expect(within(tele).getByText("210")).toBeTruthy(); // puissance moyenne
    // FC et cadence sont mesurées ; la distance est calculée.
    expect(within(tele).getAllByText("mesurée").length).toBeGreaterThanOrEqual(3);
    expect(within(tele).getAllByText("calculée").length).toBeGreaterThanOrEqual(3);
  });

  it("le survol de la carte bascule en valeurs instantanées au point survolé, et le quitter revient aux moyennes", () => {
    render(<CockpitDashboard activities={[fullSensorActivity()]} {...baseProps} />);
    fireEvent.click(screen.getByText("survol carte")); // indice 4 → FC 120 + 4*3 = 132
    const tele = panelOf("Télémétrie");
    expect(within(tele).getByText(/Au km/)).toBeTruthy();
    expect(within(tele).getByText("132")).toBeTruthy();
    expect(screen.getByTestId("map").dataset.hover).toBe("4");
  });

  it("ne transforme jamais un capteur absent en zéro", () => {
    render(<CockpitDashboard activities={[makeActivity()]} {...baseProps} />);
    const tele = panelOf("Télémétrie");
    expect(within(tele).queryByText("0")).toBeNull();
    expect(within(tele).getAllByText("indisponible").length).toBe(3); // FC, cadence, puissance
    expect(screen.getByText(/Données partielles : fréquence cardiaque, cadence, puissance/)).toBeTruthy();
  });

  it("marque une puissance estimée comme estimée, pas comme mesurée", () => {
    const a = makeActivity({
      avgPower: 180, maxPower: 400,
      flags: { ...makeActivity().flags, hasPower: true, powerEstimated: true },
    });
    render(<CockpitDashboard activities={[a]} {...baseProps} />);
    const summary = panelOf("Résumé de la sortie");
    expect(within(summary).getAllByText("estimée").length).toBe(2); // moyenne + maximale
    expect(within(summary).queryByText("mesurée")).toBeNull();
  });
});

describe("CockpitDashboard — résumé", () => {
  it("distingue vitesse moyenne (en mouvement), vitesse maximale, temps écoulé et temps en mouvement", () => {
    render(<CockpitDashboard activities={[fullSensorActivity()]} {...baseProps} />);
    const summary = panelOf("Résumé de la sortie");
    expect(within(summary).getByText("Temps écoulé")).toBeTruthy();
    expect(within(summary).getByText("Temps en mouvement")).toBeTruthy();
    expect(within(summary).getByText("1:40")).toBeTruthy();
    expect(within(summary).getByText("1:35")).toBeTruthy();
    expect(within(summary).getByText(/en mouvement\)/)).toBeTruthy();
    expect(within(summary).getByText("Vitesse maximale")).toBeTruthy();
    expect(within(summary).getByText("24,1")).toBeTruthy();
    expect(within(summary).getByText("40,0")).toBeTruthy();
    expect(within(summary).getByText("640")).toBeTruthy();
  });
});

describe("CockpitDashboard — profil d'altitude", () => {
  it("liste les montées détectées et transmet la montée choisie à la carte", () => {
    render(<CockpitDashboard activities={[fullSensorActivity()]} {...baseProps} />);
    const elevation = panelOf("Profil d'altitude");
    const climb = within(elevation).getAllByRole("button", { pressed: false })[0];
    fireEvent.click(climb);
    expect(screen.getByTestId("map").dataset.climb).not.toBe("");
    expect(climb.getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(climb);
    expect(screen.getByTestId("map").dataset.climb).toBe("");
  });

  it("annonce explicitement une altitude absente, sans fabriquer de profil", () => {
    const a = makeActivity({
      samples: makeSamples(11, () => ({ altitude: null })),
      flags: { ...makeActivity().flags, hasElevation: false },
      elevationGain: null,
    });
    render(<CockpitDashboard activities={[a]} {...baseProps} />);
    const elevation = panelOf("Profil d'altitude");
    expect(within(elevation).getByText("Altitude absente")).toBeTruthy();
    expect(elevation.querySelector("canvas")).toBeNull();
  });

  it("annonce une altitude quasi constante comme inexploitable", () => {
    render(<CockpitDashboard activities={[makeActivity({ samples: makeSamples(11, () => ({ altitude: 120 })) })]} {...baseProps} />);
    expect(within(panelOf("Profil d'altitude")).getByText("Altitude quasi constante")).toBeTruthy();
  });
});

describe("CockpitDashboard — trace absente", () => {
  it("dit que la carte est indisponible mais garde résumé et télémétrie globale", () => {
    const a = makeActivity({ samples: [] });
    render(<CockpitDashboard activities={[a]} {...baseProps} />);
    expect(within(panelOf("Carte du parcours")).getByText("Aucune trace GPS exploitable")).toBeTruthy();
    expect(screen.queryByTestId("map")).toBeNull();
    expect(within(panelOf("Profil d'altitude")).getByText("Profil indisponible")).toBeTruthy();
    expect(within(panelOf("Résumé de la sortie")).getByText("1:40")).toBeTruthy();
    expect(within(panelOf("Télémétrie")).getByText(/Pas de série point par point/)).toBeTruthy();
  });
});

describe("CockpitDashboard — sélection de sortie", () => {
  const rides = [
    fullSensorActivity({ id: "new", name: "Récente", date: "2026-09-20T08:00:00.000Z" }),
    makeActivity({ id: "old", name: "Ancienne", date: "2026-08-01T08:00:00.000Z" }),
  ];

  it("affiche la plus récente par défaut puis la sortie choisie, et réinitialise le survol", () => {
    render(<CockpitDashboard activities={rides} {...baseProps} />);
    expect(within(panelOf("Parcours")).getByText("Récente")).toBeTruthy();
    fireEvent.click(screen.getByText("survol carte"));
    expect(screen.getByTestId("map").dataset.hover).toBe("4");

    fireEvent.change(screen.getByLabelText("Sortie affichée dans le cockpit"), { target: { value: "old" } });
    expect(within(panelOf("Parcours")).getByText("Ancienne")).toBeTruthy();
    expect(screen.getByTestId("map").dataset.hover).toBe("");
  });

  it("propose le sélecteur seulement quand il y a plusieurs sorties", () => {
    render(<CockpitDashboard activities={[rides[0]]} {...baseProps} />);
    expect(screen.queryByLabelText("Sortie affichée dans le cockpit")).toBeNull();
  });
});

describe("CockpitDashboard — analyse", () => {
  it("zones de FC : calcule à partir de la FC mesurée et affiche des libellés, pas seulement des couleurs", () => {
    render(<CockpitDashboard activities={[fullSensorActivity()]} {...baseProps} />);
    const analysis = panelOf("Analyse de la sortie");
    expect(within(analysis).getByText("Z1 Récup")).toBeTruthy();
    expect(within(analysis).getAllByRole("img").length).toBe(5);
    expect(within(analysis).getByText(/FC max de référence : 190 bpm/)).toBeTruthy();
  });

  it("zones de FC : état indisponible explicite sans capteur", () => {
    render(<CockpitDashboard activities={[makeActivity()]} {...baseProps} />);
    expect(within(panelOf("Analyse de la sortie")).getByText("Fréquence cardiaque non enregistrée")).toBeTruthy();
  });

  it("zones de FC : demande une FC max quand elle n'est pas configurée", () => {
    render(<CockpitDashboard activities={[fullSensorActivity()]} userSettings={baseProps.userSettings} />);
    expect(within(panelOf("Analyse de la sortie")).getByText("FC max non configurée")).toBeTruthy();
  });

  it("records : liste les records de l'historique et signale la sortie qui en détient un", () => {
    render(<CockpitDashboard activities={[fullSensorActivity()]} {...baseProps} />);
    fireEvent.click(screen.getByRole("tab", { name: "Records" }));
    const analysis = panelOf("Analyse de la sortie");
    expect(within(analysis).getByText("Plus longue distance")).toBeTruthy();
    expect(within(analysis).getAllByText("Cette sortie").length).toBeGreaterThan(0);
  });

  it("comparaison : explique l'absence de sortie comparable", () => {
    render(<CockpitDashboard activities={[fullSensorActivity()]} {...baseProps} />);
    fireEvent.click(screen.getByRole("tab", { name: "Comparaison" }));
    expect(within(panelOf("Analyse de la sortie")).getByText("Aucune sortie comparable")).toBeTruthy();
  });

  it("comparaison : liste une sortie similaire avec ses écarts", () => {
    const twin = fullSensorActivity({ id: "twin", name: "Jumelle", date: "2026-09-01T08:00:00.000Z", avgSpeed: 22.1 });
    render(<CockpitDashboard activities={[fullSensorActivity(), twin]} {...baseProps} />);
    fireEvent.click(screen.getByRole("tab", { name: "Comparaison" }));
    const analysis = panelOf("Analyse de la sortie");
    expect(within(analysis).getByText(/Jumelle/)).toBeTruthy();
    expect(within(analysis).getByText(/\+2,0 km\/h/)).toBeTruthy();
  });

  it("meilleurs efforts : indisponibles quand la sortie est trop courte", () => {
    render(<CockpitDashboard activities={[makeActivity({ samples: makeSamples(6) })]} {...baseProps} />);
    fireEvent.click(screen.getByRole("tab", { name: "Meilleurs efforts" }));
    expect(within(panelOf("Analyse de la sortie")).getByText("Sortie trop courte")).toBeTruthy();
  });

  it("les onglets se parcourent au clavier (flèches)", () => {
    render(<CockpitDashboard activities={[fullSensorActivity()]} {...baseProps} />);
    const first = screen.getByRole("tab", { name: "Zones FC" });
    fireEvent.keyDown(first, { key: "ArrowRight" });
    expect(screen.getByRole("tab", { name: "Meilleurs efforts" }).getAttribute("aria-selected")).toBe("true");
  });

  it("n'expose aucune métrique physiologique sans méthode valide (TSS, FTP estimée, calories)", () => {
    render(<CockpitDashboard activities={[fullSensorActivity()]} {...baseProps} />);
    expect(screen.queryByText(/TSS|calories|kcal/i)).toBeNull();
  });
});

describe("CockpitDashboard : la sortie affichée est annoncée dès le haut", () => {
  it("annonce « Dernière sortie » avec sa date, y compris avec une seule sortie", () => {
    render(<CockpitDashboard activities={[fullSensorActivity({ date: "2026-09-20T08:00:00.000Z" })]} {...baseProps} />);
    expect(screen.getByText(/Dernière sortie · 20 sept\. 2026/)).toBeTruthy();
  });

  it("passe à « Sortie sélectionnée » quand on choisit une sortie plus ancienne, et revient à « Dernière sortie »", () => {
    const rides = [
      fullSensorActivity({ id: "new", name: "Récente", date: "2026-09-20T08:00:00.000Z" }),
      makeActivity({ id: "old", name: "Ancienne", date: "2026-08-01T08:00:00.000Z" }),
    ];
    render(<CockpitDashboard activities={rides} {...baseProps} />);
    const select = screen.getByLabelText("Sortie affichée dans le cockpit");
    expect(screen.getByText(/Dernière sortie · 20 sept/)).toBeTruthy();
    fireEvent.change(select, { target: { value: "old" } });
    expect(screen.getByText(/Sortie sélectionnée · 1 août 2026/)).toBeTruthy();
    fireEvent.change(select, { target: { value: "new" } });
    expect(screen.getByText(/Dernière sortie · 20 sept/)).toBeTruthy();
  });
});

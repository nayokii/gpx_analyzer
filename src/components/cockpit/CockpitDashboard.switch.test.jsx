import { describe, it, expect, afterEach, vi } from "vitest";
import { render, cleanup, screen, fireEvent, within, act } from "@testing-library/react";

import { createEmptyActivity } from "../../lib/types.js";
import { activityToPoints } from "../../lib/cockpit/rideModel.js";
import { loadRideInputs } from "../../lib/cockpit/rideSource.js";
import { stubResizeObserver } from "../testResizeObserverMock.js";
import { stubCanvasContext } from "../testCanvasMock.js";
import { CockpitDashboard } from "./CockpitDashboard.jsx";

stubResizeObserver();
stubCanvasContext();

vi.mock("../MapView.jsx", () => ({
  MapView: ({ decimated, hoverIdx, onHoverIndex, selectedClimb }) => (
    <div data-testid="map" data-points={decimated.length} data-hover={hoverIdx ?? ""} data-climb={selectedClimb ? selectedClimb.id : ""}>
      <button type="button" onClick={() => onHoverIndex(3)}>survol carte</button>
    </div>
  ),
}));
vi.mock("../../lib/cockpit/rideSource.js", () => ({ loadRideInputs: vi.fn() }));

afterEach(() => { cleanup(); vi.clearAllMocks(); });

const ZONES = [{ name: "Z1 Récup", min: 0, max: 60, color: "#111" }, { name: "Z2 Reste", min: 60, max: 999, color: "#222" }];

function samples(n, extra = () => ({})) {
  return Array.from({ length: n }, (_, i) => ({
    timestamp: new Date(Date.UTC(2026, 8, 20, 8, 0, i * 10)).toISOString(),
    latitude: 45 + i * 0.001, longitude: 5, altitude: 100 + i * 5,
    heartRate: null, cadence: null, power: null, temperature: null, distanceMeasured: null, speedMeasured: null,
    ...extra(i),
  }));
}
const base = createEmptyActivity();
const flags = { ...base.flags, hasGps: true, hasElevation: true, hasTime: true };

// A : en côte, avec FC, détient le plus gros dénivelé. B : plate, sans capteur, détient la plus longue distance.
const A = {
  ...base, id: "A", name: "Alpha", date: "2026-09-20T08:00:00Z", distance: 5, duration: 100, movingTime: 90, elevationGain: 100,
  avgSpeed: 20, avgHeartRate: 150, maxHeartRate: 170,
  flags: { ...flags, hasHeartRate: true }, samples: samples(11, () => ({ heartRate: 150 })),
};
const B = {
  ...base, id: "B", name: "Bravo", date: "2026-09-10T08:00:00Z", distance: 9, duration: 200, movingTime: 180, elevationGain: 10,
  avgSpeed: 30, flags, samples: samples(6, () => ({ altitude: 120 })),
};
const props = { userSettings: { weight: 75, bikeWeight: 8 }, maxHR: 190, hrZones: ZONES };
const region = (name) => screen.getByRole("region", { name });
const select = () => screen.getByLabelText("Sortie affichée dans le cockpit");

describe("changement de sortie (sans fichier source) : tous les panneaux suivent", () => {
  it("résumé, parcours, carte, profil, télémétrie, zones : aucune donnée de l'ancienne sortie ne subsiste", () => {
    render(<CockpitDashboard activities={[A, B]} {...props} />);

    expect(within(region("Parcours")).getByText("Alpha")).toBeTruthy();
    expect(within(region("Parcours")).getByText("En mouvement")).toBeTruthy(); // jamais une « Durée » ambiguë
    expect(screen.getByTestId("map").dataset.points).toBe("11");
    expect(within(region("Résumé de la sortie")).getByText("5,0")).toBeTruthy();
    expect(within(region("Profil d'altitude")).getAllByRole("button", { pressed: false }).length).toBeGreaterThan(0);
    expect(within(region("Télémétrie")).getByText("150")).toBeTruthy();
    expect(within(region("Analyse de la sortie")).getByText("Z1 Récup")).toBeTruthy();

    // état propre à A : montée choisie + survol
    fireEvent.click(within(region("Profil d'altitude")).getAllByRole("button", { pressed: false })[0]);
    fireEvent.click(screen.getByText("survol carte"));
    expect(screen.getByTestId("map").dataset.climb).not.toBe("");
    expect(screen.getByTestId("map").dataset.hover).toBe("3");

    fireEvent.change(select(), { target: { value: "B" } });
    expect(within(region("Parcours")).getByText("Bravo")).toBeTruthy();
    expect(within(region("Parcours")).queryByText("Alpha")).toBeNull();
    expect(screen.getByTestId("map").dataset.points).toBe("6");
    expect(screen.getByTestId("map").dataset.climb).toBe("");
    expect(screen.getByTestId("map").dataset.hover).toBe("");
    const summary = region("Résumé de la sortie");
    expect(within(summary).getByText("9,0")).toBeTruthy();
    expect(within(summary).queryByText("5,0")).toBeNull();
    expect(within(summary).getByText("3:00")).toBeTruthy(); // temps en mouvement de B (180 s)
    expect(within(region("Profil d'altitude")).getByText("Altitude quasi constante")).toBeTruthy();
    expect(within(region("Profil d'altitude")).queryAllByRole("button").length).toBe(0);
    const tele = region("Télémétrie");
    expect(within(tele).queryByText("150")).toBeNull();
    expect(within(tele).getByText(/Moyennes de la sortie/)).toBeTruthy();
    expect(within(region("Analyse de la sortie")).getByText("Fréquence cardiaque non enregistrée")).toBeTruthy();
    expect(screen.getByText(/Données partielles : fréquence cardiaque, cadence, puissance/)).toBeTruthy();
  });

  it("records et comparaisons suivent la sortie sélectionnée", () => {
    render(<CockpitDashboard activities={[A, B]} {...props} />);
    fireEvent.click(screen.getByRole("tab", { name: "Records" }));
    const rowOf = (label) => screen.getByText(label).closest("li").textContent;
    expect(rowOf("Plus gros dénivelé +")).toMatch(/Cette sortie/);
    expect(rowOf("Plus longue distance")).not.toMatch(/Cette sortie/);

    fireEvent.change(select(), { target: { value: "B" } });
    expect(rowOf("Plus gros dénivelé +")).not.toMatch(/Cette sortie/);
    expect(rowOf("Plus longue distance")).toMatch(/Cette sortie/);
  });
});

describe("chargement du fichier source : pas de données périmées", () => {
  function deferred() { let resolve, reject; const promise = new Promise((res, rej) => { resolve = res; reject = rej; }); return { promise, resolve, reject }; }
  const inputsFor = (a) => ({ points: activityToPoints(a), measured: null, source: "file" });

  it("affiche un chargement, puis la sortie ; jamais le tracé de l'ancienne pendant le chargement de la nouvelle", async () => {
    const d = { A: deferred(), B: deferred() };
    loadRideInputs.mockImplementation((_root, activity) => d[activity.id].promise);
    render(<CockpitDashboard activities={[A, B]} {...props} rootHandle={{}} />);

    expect(screen.queryByTestId("map")).toBeNull();
    expect(screen.getByText("Chargement du tracé…")).toBeTruthy();
    expect(within(region("Résumé de la sortie")).getByText("5,0")).toBeTruthy(); // les agrégats de l'Activity restent immédiats

    await act(async () => d.A.resolve(inputsFor(A)));
    expect(screen.getByTestId("map").dataset.points).toBe("11");

    fireEvent.change(select(), { target: { value: "B" } });
    expect(screen.queryByTestId("map")).toBeNull();
    await act(async () => d.B.resolve(inputsFor(B)));
    expect(screen.getByTestId("map").dataset.points).toBe("6");
  });

  it("ignore une réponse tardive d'une sortie qui n'est plus affichée", async () => {
    const d = { A: deferred(), B: deferred() };
    loadRideInputs.mockImplementation((_root, activity) => d[activity.id].promise);
    render(<CockpitDashboard activities={[A, B]} {...props} rootHandle={{}} />);

    fireEvent.change(select(), { target: { value: "B" } });
    fireEvent.change(select(), { target: { value: "A" } });
    await act(async () => d.A.resolve(inputsFor(A)));
    await act(async () => d.B.resolve(inputsFor(B))); // arrive après : doit être ignorée
    expect(within(region("Parcours")).getByText("Alpha")).toBeTruthy();
    expect(screen.getByTestId("map").dataset.points).toBe("11");
  });

  it("une lecture en erreur retombe sur les samples (jamais « chargement » indéfini) et ne touche pas la sortie suivante", async () => {
    const d = { A: deferred(), B: deferred() };
    loadRideInputs.mockImplementation((root, activity) => (root === null ? Promise.resolve({ points: activityToPoints(activity), measured: null, source: "samples" }) : d[activity.id].promise));
    render(<CockpitDashboard activities={[A, B]} {...props} rootHandle={{}} />);

    await act(async () => d.A.resolve(inputsFor(A)));
    fireEvent.change(select(), { target: { value: "B" } });
    fireEvent.change(select(), { target: { value: "A" } });
    fireEvent.change(select(), { target: { value: "B" } });
    await act(async () => d.A.reject(new Error("lecture A tardive"))); // A n'est plus affichée : ignorée
    expect(screen.queryByTestId("map")).toBeNull(); // B charge toujours
    await act(async () => d.B.reject(new Error("fichier B illisible")));
    expect(within(region("Parcours")).getByText("Bravo")).toBeTruthy();
    expect(screen.getByTestId("map").dataset.points).toBe("6"); // repli sur les samples de B, pas ceux de A
    expect(screen.getByText(/relissée depuis les échantillons|Altitude quasi constante/)).toBeTruthy();
  });
});

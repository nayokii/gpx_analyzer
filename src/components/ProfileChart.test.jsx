import { describe, it, expect, afterEach } from "vitest";
import { render, cleanup, screen } from "@testing-library/react";
import { ProfileChart } from "./ProfileChart.jsx";

afterEach(cleanup);

const DECIMATED = [
  { distance: 0, speed: 10, lat: 0, lon: 0 },
  { distance: 1, speed: 14, lat: 0, lon: 0 },
];

describe("ProfileChart — métrique de repli", () => {
  it("met en évidence la métrique réellement affichée quand la métrique demandée n'est pas disponible (sortie sans altitude)", () => {
    const analysis = { hasEle: false, hasTime: true, hasHR: false, hasCad: false, hasPower: false, climbs: [] };
    render(
      <ProfileChart
        analysis={analysis} decimated={DECIMATED} metric="altitude" setMetric={() => {}}
        hoverIdx={null} setHoverIdx={() => {}} selectedClimb={null} onSelectClimb={() => {}}
      />
    );
    // « altitude » est demandée par l'état parent mais indisponible : seule « Vitesse » existe et doit paraître active.
    expect(screen.queryByText("Altitude")).toBeNull();
    expect(screen.getByText("Vitesse").className).toContain("gpx-chip-active");
  });

  it("garde la métrique demandée quand elle est disponible", () => {
    const analysis = { hasEle: true, hasTime: true, hasHR: false, hasCad: false, hasPower: false, climbs: [] };
    const decimated = DECIMATED.map((p) => ({ ...p, ele: 20, grade: 1 }));
    render(
      <ProfileChart
        analysis={analysis} decimated={decimated} metric="vitesse" setMetric={() => {}}
        hoverIdx={null} setHoverIdx={() => {}} selectedClimb={null} onSelectClimb={() => {}}
      />
    );
    expect(screen.getByText("Vitesse").className).toContain("gpx-chip-active");
    expect(screen.getByText("Altitude").className).not.toContain("gpx-chip-active");
  });
});

describe("ProfileChart — infobulle de puissance", () => {
  const analysis = { hasEle: false, hasTime: true, hasHR: false, hasCad: false, hasPower: true, climbs: [] };
  const decimated = [{ distance: 0, speed: 10, power: 150, lat: 0, lon: 0 }, { distance: 1, speed: 14, power: 180, lat: 0, lon: 0 }];
  const renderChart = (extra = {}) => render(
    <ProfileChart analysis={analysis} decimated={decimated} metric="puissance" setMetric={() => {}}
      hoverIdx={1} setHoverIdx={() => {}} selectedClimb={null} onSelectClimb={() => {}} {...extra} />
  );

  it("garde le libellé « Puissance » par défaut (autres graphiques inchangés)", () => {
    renderChart();
    expect(screen.getAllByText("Puissance").length).toBeGreaterThan(0);
    expect(screen.queryByText("Puissance (estimée)")).toBeNull();
  });

  it("affiche le libellé fourni par l'appelant pour une puissance estimée", () => {
    renderChart({ powerLabel: "Puissance (estimée)" });
    expect(screen.getByText("Puissance (estimée)")).toBeTruthy();
  });
});

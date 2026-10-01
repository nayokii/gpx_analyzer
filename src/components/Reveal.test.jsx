import { describe, it, expect, afterEach } from "vitest";
import { render, cleanup, screen, waitFor, fireEvent } from "@testing-library/react";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Vitest neutralise les imports CSS : on lit le fichier source des tokens directement.
const tokensCss = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "styles", "tokens.css"), "utf8");

import { MemoryDirectoryHandle } from "../lib/storage/testFsHandle.js";
import { saveActivity } from "../lib/storage/activityStore.js";
import { createEmptyActivity } from "../lib/types.js";
import { HistoryDashboard } from "./HistoryDashboard.jsx";
import { Reveal } from "./Reveal.jsx";
import { stubResizeObserver } from "./testResizeObserverMock.js";

stubResizeObserver();
afterEach(cleanup);
const noop = () => {};

function makeActivity(id, date, distance) {
  const a = createEmptyActivity();
  return {
    ...a, id, name: "Sortie " + id, date, distance, duration: 5400, movingTime: 5000, elevationGain: 300, elevationLoss: 280,
    avgSpeed: 21.6, maxSpeed: 45, flags: { ...a.flags }, samples: [], gpsTrack: [],
  };
}

describe("Reveal — primitive", () => {
  it("rend ses enfants tels quels dans un wrapper .gpx-reveal, sans dépendre d'aucune donnée", () => {
    render(<Reveal><p>contenu</p></Reveal>);
    expect(screen.getByText("contenu")).toBeTruthy();
    const el = document.querySelector(".gpx-reveal");
    expect(el).toBeTruthy();
    expect(el.style.getPropertyValue("--reveal-delay")).toBe("");
  });

  it("expose le délai via --reveal-delay", () => {
    render(<Reveal delay={60}>x</Reveal>);
    expect(document.querySelector(".gpx-reveal").style.getPropertyValue("--reveal-delay")).toBe("60ms");
  });

  it("ne rejoue pas l'animation (même nœud DOM) quand le contenu change", () => {
    const { rerender } = render(<Reveal delay={30}><span>a</span></Reveal>);
    const node = document.querySelector(".gpx-reveal");
    rerender(<Reveal delay={30}><span>b</span></Reveal>);
    expect(document.querySelector(".gpx-reveal")).toBe(node);
    expect(screen.getByText("b")).toBeTruthy();
  });
});

describe("Reveal — CSS (tokens.css)", () => {
  it("utilise les tokens existants (--dur-base, --ease), opacité + translateY ≤ 4px, fill-mode backwards", () => {
    expect(tokensCss).toMatch(/\.gpx-reveal\s*\{[^}]*var\(--dur-base\)\s+var\(--ease\)[^}]*backwards/);
    const kf = /@keyframes gpx-reveal-in\s*\{([\s\S]*?)\n\}/.exec(tokensCss)[1];
    expect(kf).toMatch(/opacity: 0/);
    const dy = /translateY\((\d+)px\)/.exec(kf);
    expect(dy && Number(dy[1])).toBeLessThanOrEqual(4);
    expect(kf).not.toMatch(/scale|blur|filter/);
  });

  it("prefers-reduced-motion : aucune animation, donc aucun contenu masqué par une opacité initiale", () => {
    const m = /@media \(prefers-reduced-motion: reduce\)\s*\{\s*\.gpx-reveal\s*\{\s*animation:\s*none;\s*\}\s*\}/.exec(tokensCss);
    expect(m).toBeTruthy();
  });

  it("les délais utilisés dans l'Historique ne dépassent pas 40 ms entre deux groupes voisins", () => {
    const delays = [0, 30, 60, 90, 120, 150, 180];
    for (let i = 1; i < delays.length; i++) expect(delays[i] - delays[i - 1]).toBeLessThanOrEqual(40);
  });
});

describe("Historique — cascade sans changement fonctionnel", () => {
  async function renderWithData() {
    const root = new MemoryDirectoryHandle();
    await saveActivity(root, makeActivity("a1", new Date().toISOString(), 30), "<gpx/>", "gpx");
    await saveActivity(root, makeActivity("a2", new Date(Date.now() - 86400000).toISOString(), 25), "<gpx/>", "gpx");
    return render(
      <HistoryDashboard storage={{ status: "connected", rootHandle: root, dirName: "test" }} onConnect={noop} onReconnect={noop} onOpen={noop} onBack={noop} />
    );
  }

  it("tout le contenu est présent, regroupé en quelques groupes avec des délais croissants", async () => {
    const { container } = await renderWithData();
    await waitFor(() => expect(screen.getByText("Records (toutes les sorties)")).toBeTruthy());
    expect(screen.getByText("Période")).toBeTruthy();
    expect(screen.getByText("Historique")).toBeTruthy();
    expect(screen.getByText("Sortie a1")).toBeTruthy();
    const groups = [...container.querySelectorAll(".gpx-reveal")];
    expect(groups.length).toBeLessThanOrEqual(8); // quelques groupes, pas une animation par composant
    const delays = groups.map((g) => parseInt(g.style.getPropertyValue("--reveal-delay") || "0", 10));
    expect(Math.max(...delays)).toBeLessThanOrEqual(180);
    // jamais de .gpx-reveal sur une ligne ou une cellule de tableau
    expect(container.querySelector("tr.gpx-reveal, td.gpx-reveal, tbody .gpx-reveal")).toBeNull();
  });

  it("changer de période ne remonte pas les groupes (donc ne rejoue pas la cascade)", async () => {
    const { container } = await renderWithData();
    await waitFor(() => expect(screen.getByText("Records (toutes les sorties)")).toBeTruthy());
    const before = [...container.querySelectorAll(".gpx-reveal")];
    fireEvent.click(screen.getByText("7 jours"));
    await waitFor(() => expect(screen.getByText("Période")).toBeTruthy());
    const after = [...container.querySelectorAll(".gpx-reveal")];
    for (const node of before) expect(after).toContain(node);
  });
});

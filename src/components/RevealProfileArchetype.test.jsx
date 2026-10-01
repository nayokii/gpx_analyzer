import { describe, it, expect, afterEach } from "vitest";
import { render, cleanup, screen, waitFor } from "@testing-library/react";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { MemoryDirectoryHandle } from "../lib/storage/testFsHandle.js";
import { saveActivity } from "../lib/storage/activityStore.js";
import { parseFITArrayBuffer } from "../lib/parsers/fitParser.js";
import { computeAnalysis } from "../lib/analysis.js";
import { toActivity } from "../lib/normalize.js";
import { ProfileView } from "./ProfileView.jsx";
import { ArchetypeView } from "./ArchetypeView.jsx";
import { stubResizeObserver } from "./testResizeObserverMock.js";

stubResizeObserver();
afterEach(cleanup);
const noop = () => {};

const FIXTURE = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "lib", "parsers", "__fixtures__", "ride-2026-09-20.fit");

async function storageWithOneRide() {
  const buf = fs.readFileSync(FIXTURE);
  const arrayBuffer = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  const { name, points, measured } = await parseFITArrayBuffer(arrayBuffer);
  const analysis = computeAnalysis(points, { weight: 75, bikeWeight: 8 });
  const activity = toActivity(analysis, points, { name, sourceType: "fit", originalFilename: "ride.fit", measured });
  const root = new MemoryDirectoryHandle();
  await saveActivity(root, activity, arrayBuffer, "fit");
  return { status: "connected", rootHandle: root, dirName: "test" };
}

const delaysOf = (container) =>
  [...container.querySelectorAll(".gpx-reveal")].map((g) => parseInt(g.style.getPropertyValue("--reveal-delay") || "0", 10));

function expectCascadeShape(container, maxDelay) {
  const delays = delaysOf(container);
  expect(delays.length).toBeGreaterThan(0);
  expect(delays.length).toBeLessThanOrEqual(7); // quelques groupes, jamais un par carte/badge
  expect(Math.max(...delays)).toBeLessThanOrEqual(maxDelay);
  const sorted = [...new Set(delays)].sort((a, b) => a - b);
  for (let i = 1; i < sorted.length; i++) expect(sorted[i] - sorted[i - 1]).toBeLessThanOrEqual(40);
  // pas d'animation individuelle des petits éléments
  expect(container.querySelector(".gpx-reveal .gpx-reveal")).toBeNull();
  expect(container.querySelector(".gpx-profile-card.gpx-reveal, .gpx-profile-grid .gpx-reveal, .gpx-confidence-badge.gpx-reveal")).toBeNull();
}

describe("Profil — cascade (Phase 5B)", () => {
  it("groupe l'en-tête, le stockage, la qualité des données, les dimensions, le détail et l'évolution", async () => {
    const storage = await storageWithOneRide();
    const { container } = render(<ProfileView storage={storage} onConnect={noop} onReconnect={noop} onBack={noop} />);
    await waitFor(() => expect(screen.getByText(/Analyse basée sur 1 sortie/)).toBeTruthy());
    expectCascadeShape(container, 150);
    // les 7 dimensions sont dans UN seul groupe
    const dimGroup = screen.getByText("Dimensions").closest(".gpx-reveal");
    expect(dimGroup).toBeTruthy();
    expect(dimGroup.querySelectorAll(".gpx-profile-card").length).toBeGreaterThan(1);
  });

  it("la confiance et les limites restent affichées immédiatement, hors cascade", async () => {
    const storage = await storageWithOneRide();
    render(<ProfileView storage={storage} onConnect={noop} onReconnect={noop} onBack={noop} />);
    await waitFor(() => expect(screen.getByText(/Profil en construction/)).toBeTruthy());
    expect(screen.getByText(/Profil en construction/).closest(".gpx-reveal")).toBeNull();
  });

  it("le contenu est identique avec ou sans wrapper : valeurs et libellés inchangés", async () => {
    const storage = await storageWithOneRide();
    render(<ProfileView storage={storage} onConnect={noop} onReconnect={noop} onBack={noop} />);
    await waitFor(() => expect(screen.getAllByText("Sprint").length).toBeGreaterThan(0));
    expect(screen.getByText("Mon profil cycliste")).toBeTruthy();
    expect(screen.getAllByText("Données insuffisantes").length).toBeGreaterThan(0);
  });
});

describe("Archétype — cascade (Phase 5B)", () => {
  it("groupe l'en-tête, le stockage, la correspondance, les références et l'évolution", async () => {
    const storage = await storageWithOneRide();
    const { container } = render(<ArchetypeView storage={storage} onConnect={noop} onReconnect={noop} onBack={noop} />);
    await waitFor(() => expect(screen.getByText(/Basé sur 1 sortie/)).toBeTruthy());
    expectCascadeShape(container, 120);
  });

  it("les limites/confiance restent affichées immédiatement, hors cascade", async () => {
    const storage = await storageWithOneRide();
    render(<ArchetypeView storage={storage} onConnect={noop} onReconnect={noop} onBack={noop} />);
    await waitFor(() => expect(screen.getByText(/Archétype en construction/)).toBeTruthy());
    expect(screen.getByText(/Archétype en construction/).closest(".gpx-reveal")).toBeNull();
  });
});

import { describe, it, expect, afterEach, vi } from "vitest";
import { render, cleanup, screen, waitFor, fireEvent } from "@testing-library/react";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { MemoryDirectoryHandle } from "../lib/storage/testFsHandle.js";
import { saveActivity } from "../lib/storage/activityStore.js";
import { createEmptyActivity } from "../lib/types.js";
import { parseFITArrayBuffer } from "../lib/parsers/fitParser.js";
import { computeAnalysis } from "../lib/analysis.js";
import { toActivity } from "../lib/normalize.js";
import { computeCyclistProfile } from "../lib/profile/profile.js";
import { computeProgression } from "../lib/progression/progression.js";
import { matchArchetypes } from "../lib/archetypes/matching.js";
import { HomeView } from "./HomeView.jsx";
import { stubResizeObserver } from "./testResizeObserverMock.js";

stubResizeObserver();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_PATH = path.join(__dirname, "..", "lib", "parsers", "__fixtures__", "ride-2026-09-20.fit");

function loadFitFixtureArrayBuffer() {
  const buf = fs.readFileSync(FIXTURE_PATH);
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
}

async function loadRealFitActivity() {
  const arrayBuffer = loadFitFixtureArrayBuffer();
  const { name, points, measured } = await parseFITArrayBuffer(arrayBuffer);
  const analysis = computeAnalysis(points, { weight: 75, bikeWeight: 8 });
  const activity = toActivity(analysis, points, { name, sourceType: "fit", originalFilename: "ride.fit", measured });
  return { activity, arrayBuffer };
}

function connectedStorage(root) {
  return { status: "connected", rootHandle: root, dirName: "test" };
}

const noop = () => {};
const noopUpload = {
  dragOver: false,
  onDragOver: noop,
  onDragLeave: noop,
  onDrop: noop,
  onBrowseClick: noop,
  error: null,
};

afterEach(cleanup);

describe("HomeView — stockage non connecté", () => {
  it("affiche l'écran d'import, jamais une synthèse fabriquée", () => {
    render(
      <HomeView
        storage={{ status: "disconnected", rootHandle: null }}
        onConnect={noop}
        onReconnect={noop}
        onNavigate={noop}
        onOpenActivity={noop}
        onLoadDemo={noop}
        upload={noopUpload}
      />
    );
    expect(screen.getByText(/Glissez-déposez votre fichier/)).toBeTruthy();
    expect(screen.queryByText("Bonjour.")).toBeNull();
  });
});

describe("HomeView — 0 activité", () => {
  it("affiche aussi l'écran d'import (pas de cartes de synthèse sans données)", async () => {
    const root = new MemoryDirectoryHandle();
    render(
      <HomeView storage={connectedStorage(root)} onConnect={noop} onReconnect={noop} onNavigate={noop} onOpenActivity={noop} onLoadDemo={noop} upload={noopUpload} />
    );
    await waitFor(() => expect(screen.getByText(/Glissez-déposez votre fichier/)).toBeTruthy());
  });
});

describe("HomeView — synthèse avec le vrai FIT (cold start)", () => {
  it("affiche des valeurs de synthèse identiques à celles des moteurs appelés directement — aucun calcul dupliqué/divergent", async () => {
    const root = new MemoryDirectoryHandle();
    const { activity, arrayBuffer } = await loadRealFitActivity();
    await saveActivity(root, activity, arrayBuffer, "fit");

    const profile = computeCyclistProfile([activity]);
    const progression = computeProgression([activity], profile);
    const archetypeMatch = matchArchetypes(profile);

    render(
      <HomeView storage={connectedStorage(root)} onConnect={noop} onReconnect={noop} onNavigate={noop} onOpenActivity={noop} onLoadDemo={noop} upload={noopUpload} />
    );

    await waitFor(() => expect(screen.getByText("Bonjour.")).toBeTruthy());

    expect(screen.getByText(`Niveau ${progression.level} — ${progression.title}`)).toBeTruthy();
    expect(screen.getByText(String(profile.dimensions.endurance.value))).toBeTruthy();
    expect(screen.getByText(archetypeMatch.combinedLabel)).toBeTruthy();
    expect(screen.getByText(activity.name)).toBeTruthy();
  });

  it("les cartes ouvrent la page correspondante au clic, sans dupliquer le calcul qui s'y trouve déjà", async () => {
    const root = new MemoryDirectoryHandle();
    const { activity, arrayBuffer } = await loadRealFitActivity();
    await saveActivity(root, activity, arrayBuffer, "fit");
    const onNavigate = vi.fn();

    render(
      <HomeView storage={connectedStorage(root)} onConnect={noop} onReconnect={noop} onNavigate={onNavigate} onOpenActivity={noop} onLoadDemo={noop} upload={noopUpload} />
    );
    await waitFor(() => expect(screen.getByText("Bonjour.")).toBeTruthy());

    fireEvent.click(screen.getByText("Alter Ego").closest(".gpx-home-card"));
    expect(onNavigate).toHaveBeenCalledWith("alterego");
    fireEvent.click(screen.getByText("Profil").closest(".gpx-home-card"));
    expect(onNavigate).toHaveBeenCalledWith("profil");
    fireEvent.click(screen.getByText("Archétype").closest(".gpx-home-card"));
    expect(onNavigate).toHaveBeenCalledWith("archetype");
  });

  it("ouvre la dernière sortie au clic sur sa carte", async () => {
    const root = new MemoryDirectoryHandle();
    const { activity, arrayBuffer } = await loadRealFitActivity();
    await saveActivity(root, activity, arrayBuffer, "fit");
    const onOpenActivity = vi.fn();

    render(
      <HomeView storage={connectedStorage(root)} onConnect={noop} onReconnect={noop} onNavigate={noop} onOpenActivity={onOpenActivity} onLoadDemo={noop} upload={noopUpload} />
    );
    await waitFor(() => expect(screen.getByText("Bonjour.")).toBeTruthy());
    fireEvent.click(screen.getByText("Dernière sortie").closest(".gpx-home-card"));
    expect(onOpenActivity).toHaveBeenCalledWith(activity.id);
  });
});

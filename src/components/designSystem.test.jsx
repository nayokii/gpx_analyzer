import { describe, it, expect, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { HistoryDashboard } from "./HistoryDashboard.jsx";
import { ActivityFeedView } from "./ActivityFeedView.jsx";
import { HomeView } from "./HomeView.jsx";
import { ProfileView } from "./ProfileView.jsx";
import { ArchetypeView } from "./ArchetypeView.jsx";
import { AlterEgoView } from "./AlterEgoView.jsx";
import { CoachView } from "./CoachView.jsx";
import { TourView } from "./TourView.jsx";
import { DataSourcesView } from "./DataSourcesView.jsx";
import { stubResizeObserver } from "./testResizeObserverMock.js";

stubResizeObserver();
afterEach(cleanup);

const here = path.dirname(fileURLToPath(import.meta.url));
const read = (rel) => fs.readFileSync(path.join(here, rel), "utf-8");
const noop = () => {};
const disconnected = { status: "disconnected", rootHandle: null };

describe("design system : migration progressive par classe .gpx-ds", () => {
  it("Sorties et Activités portent la classe .gpx-ds", () => {
    const sorties = render(<HistoryDashboard storage={disconnected} onConnect={noop} onReconnect={noop} onOpen={noop} onBack={noop} />);
    expect(sorties.container.querySelector(".gpx-dashboard.gpx-ds")).toBeTruthy();
    sorties.unmount();
    const activites = render(<ActivityFeedView storage={disconnected} onConnect={noop} onReconnect={noop} onOpen={noop} onBack={noop} />);
    expect(activites.container.querySelector(".gpx-dashboard.gpx-feed.gpx-ds")).toBeTruthy();
  });

  it("Profil, Archétype et Alter Ego portent la classe .gpx-ds, et chacun conserve son unique titre h1", () => {
    const props = { storage: disconnected, onConnect: noop, onReconnect: noop, onBack: noop, onOpen: noop, onViewArchetype: noop, onViewProfile: noop };
    for (const [View, title] of [[ProfileView, "Mon profil cycliste"], [ArchetypeView, "Archétype"], [AlterEgoView, "Alter Ego"]]) {
      const { container, unmount } = render(<View {...props} />);
      expect(container.querySelector(".gpx-dashboard.gpx-ds"), title).toBeTruthy();
      const h1 = container.querySelectorAll("h1");
      expect(h1).toHaveLength(1);
      expect(h1[0].textContent).toBe(title);
      unmount();
    }
  });

  it("Coach, Tour et Sources de données portent la classe .gpx-ds et gardent un seul h1", () => {
    const props = { storage: disconnected, onConnect: noop, onReconnect: noop, onBack: noop, onViewProfile: noop, onDisconnectStorage: noop, isDemo: false, refreshSignal: 0 };
    for (const [View, title] of [[CoachView, "Coach"], [TourView, "Tour Simulator"], [DataSourcesView, "Sources de données"]]) {
      const { container, unmount } = render(<View {...props} />);
      expect(container.querySelector(".gpx-dashboard.gpx-ds"), title).toBeTruthy();
      const h1 = container.querySelectorAll("h1");
      expect(h1).toHaveLength(1);
      expect(h1[0].textContent).toBe(title);
      unmount();
    }
  });

  it("la page de récupération de mot de passe (flux d'authentification, hors shell) ne porte pas .gpx-ds", () => {
    expect(read("./PasswordRecoveryView.jsx")).not.toContain("gpx-ds");
  });

  it("le Dashboard (cockpit) ne porte pas .gpx-ds : ses styles restent indépendants des conventions de page", () => {
    const upload = { dragOver: false, onDragOver: noop, onDragLeave: noop, onDrop: noop, onBrowseClick: noop, error: null };
    const { container } = render(<HomeView storage={disconnected} onConnect={noop} onReconnect={noop} onNavigate={noop} onOpenActivity={noop} onLoadDemo={noop} upload={upload} />);
    expect(container.querySelector(".gpx-ds")).toBeNull();
  });

  it("toutes les règles de ds.css sont portées par .gpx-ds : aucune fuite possible vers le Dashboard ni vers les vues non migrées", () => {
    const css = read("../styles/ds.css").replace(/\/\*[\s\S]*?\*\//g, "");
    const preambles = [...css.matchAll(/([^{}]+)\{/g)].map((m) => m[1].trim()).filter((p) => p && !p.startsWith("@"));
    expect(preambles.length).toBeGreaterThan(20);
    for (const preamble of preambles) {
      for (const selector of preamble.split(",").map((s) => s.trim())) {
        expect(selector.startsWith(".gpx-ds"), `sélecteur non scopé : ${selector}`).toBe(true);
      }
    }
  });
});

describe("Dashboard : garde-fous contre la régression « dossier local obligatoire »", () => {
  const src = read("./HomeView.jsx");

  it("lit ses sorties via le dépôt unifié local + cloud, pas via le seul dossier local", () => {
    expect(src).toContain("useUnifiedActivities");
    expect(src).toContain("useActivityRepository");
    expect(src).not.toMatch(/import\s*\{[^}]*\blistActivities\b[^}]*\}\s*from\s*"\.\.\/lib\/storage\/activityStore\.js"/);
    expect(src).not.toMatch(/loadCachedActivityDetails/);
  });

  it("considère qu'une source existe avec un dossier connecté OU un compte cloud", () => {
    expect(src).toMatch(/hasSource\s*=\s*storage\.status === "connected" \|\| repository\.hasCloud/);
  });
});

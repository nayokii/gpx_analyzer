import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, cleanup, screen, waitFor, fireEvent, within } from "@testing-library/react";

import { MemoryDirectoryHandle } from "../lib/storage/testFsHandle.js";
import { saveActivity } from "../lib/storage/activityStore.js";
import { createEmptyActivity } from "../lib/types.js";
import { loopRoute } from "../lib/feed/testRoutes.js";
import { ActivityFeedView } from "./ActivityFeedView.jsx";
import { __clearDetailCacheForTests } from "./ActivityPost.jsx";
import { recordingCtx } from "../lib/feed/testCanvas.js";

function makeActivity(id, o = {}) {
  const a = createEmptyActivity();
  const route = loopRoute(120);
  return {
    ...a, id, name: `Sortie ${id}`, date: "2026-09-20T08:00:00.000Z", sportType: "cycling",
    distance: 30, duration: 5400, movingTime: 5000, elevationGain: 300, elevationLoss: 280, avgSpeed: 21.6,
    avgHeartRate: 140, maxHeartRate: 175, avgCadence: 85,
    flags: { ...a.flags, hasGps: true, hasHeartRate: true, hasCadence: true },
    gpsTrack: route,
    samples: route.map((p, i) => ({ latitude: p.lat, longitude: p.lon, altitude: 300 + 50 * Math.sin(i / 10) })),
    ...o,
  };
}

async function seed(root, activities) {
  for (const a of activities) await saveActivity(root, a, "<gpx/>", "gpx");
}
const connected = (root) => ({ status: "connected", rootHandle: root, dirName: "test" });
const noop = () => {};
const renderFeed = (root, props = {}) =>
  render(<ActivityFeedView storage={connected(root)} onConnect={noop} onReconnect={noop} onOpen={noop} onBack={noop} {...props} />);

const titles = () => screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent.replace(/renommée$/, ""));

beforeEach(() => {
  window.localStorage.clear();
  __clearDetailCacheForTests();
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe("ActivityFeedView — états", () => {
  it("invite à connecter un dossier quand aucun stockage n'est disponible", () => {
    render(<ActivityFeedView storage={{ status: "disconnected", rootHandle: null }} onConnect={noop} onReconnect={noop} onOpen={noop} onBack={noop} />);
    expect(screen.getByText(/Connecte un dossier local/)).toBeTruthy();
    expect(screen.queryByRole("search")).toBeNull();
  });
  it("état vide explicite sans activité", async () => {
    renderFeed(new MemoryDirectoryHandle());
    await waitFor(() => expect(screen.getByText(/Aucune sortie enregistrée/)).toBeTruthy());
  });
  it("affiche une erreur avec « Réessayer » si la lecture échoue", async () => {
    const root = new MemoryDirectoryHandle();
    root.getDirectoryHandle = () => Promise.reject(new Error("Disque illisible"));
    renderFeed(root);
    await waitFor(() => expect(screen.getByRole("alert").textContent).toMatch(/Disque illisible/));
    expect(screen.getByText("Réessayer")).toBeTruthy();
  });
  it("lecture seule : n'écrit aucun fichier", async () => {
    const root = new MemoryDirectoryHandle();
    renderFeed(root);
    await waitFor(() => expect(screen.getByText(/Aucune sortie enregistrée/)).toBeTruthy());
    expect(root.files.size).toBe(0);
  });
});

describe("ActivityFeedView — publications", () => {
  it("liste les sorties de la plus récente à la plus ancienne avec distance, tracé et stats", async () => {
    const root = new MemoryDirectoryHandle();
    await seed(root, [
      makeActivity("ancienne", { name: "Ancienne", date: "2026-08-01T08:00:00.000Z" }),
      makeActivity("recente", { name: "Récente", date: "2026-09-25T08:00:00.000Z", distance: 61.2 }),
    ]);
    renderFeed(root);
    await waitFor(() => expect(titles()).toEqual(["Récente", "Ancienne"]));
    await waitFor(() => expect(screen.getAllByRole("img", { name: /^Tracé de/ }).length).toBe(2));
    expect(screen.getByText("61,2")).toBeTruthy();
    expect(screen.getAllByText("km").length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Départ/).length).toBe(2);
  });

  it("GPS absent : état de remplacement, jamais de tracé inventé", async () => {
    const root = new MemoryDirectoryHandle();
    await seed(root, [makeActivity("nogps", { gpsTrack: [], samples: [], flags: { hasGps: false } })]);
    renderFeed(root);
    await waitFor(() => expect(screen.getByLabelText("Tracé GPS indisponible")).toBeTruthy());
    expect(screen.queryByRole("img", { name: /^Tracé de/ })).toBeNull();
  });

  it("cardio/cadence absents : lignes masquées, aucun « 0 bpm »", async () => {
    const root = new MemoryDirectoryHandle();
    await seed(root, [makeActivity("nohr", { avgHeartRate: null, maxHeartRate: null, avgCadence: null })]);
    renderFeed(root);
    await waitFor(() => expect(screen.getAllByRole("img", { name: /^Tracé de/ }).length).toBe(1));
    expect(screen.queryByText(/bpm/)).toBeNull();
    expect(screen.queryByText(/rpm/)).toBeNull();
    expect(screen.queryByText(/FC moy/)).toBeNull();
  });

  it("cardio présent : affiché avec la FC max", async () => {
    const root = new MemoryDirectoryHandle();
    await seed(root, [makeActivity("hr")]);
    renderFeed(root);
    await waitFor(() => expect(screen.getByText(/max 175/)).toBeTruthy()); // la FC max vient du détail complet
    expect(screen.getByText(/FC moy/)).toBeTruthy();
  });

  it("puissance estimée signalée comme telle", async () => {
    const root = new MemoryDirectoryHandle();
    const a = makeActivity("pw", { avgPower: 190, maxPower: 600 });
    a.flags.powerEstimated = true;
    await seed(root, [a]);
    renderFeed(root);
    await waitFor(() => expect(screen.getByText("estimée")).toBeTruthy());
  });

  it("« Ouvrir la sortie » transmet l'id", async () => {
    const root = new MemoryDirectoryHandle();
    await seed(root, [makeActivity("x1")]);
    const onOpen = vi.fn();
    renderFeed(root, { onOpen });
    fireEvent.click(await screen.findByText("Ouvrir la sortie"));
    expect(onOpen).toHaveBeenCalledWith("x1");
  });
});

describe("ActivityFeedView — noms modifiés", () => {
  it("renomme sans toucher aux fichiers de la sortie, et persiste le nom", async () => {
    const root = new MemoryDirectoryHandle();
    await seed(root, [makeActivity("r1", { name: "Nom d'origine" })]);
    const before = new Map([...root.files].map(([k, v]) => [k, JSON.stringify(v)]));
    renderFeed(root);
    fireEvent.click(await screen.findByLabelText("Renommer Nom d'origine"));
    const input = screen.getByLabelText("Nom de la sortie");
    fireEvent.change(input, { target: { value: "  Mon Ventoux   2026 " } });
    fireEvent.submit(input.closest("form"));
    await waitFor(() => expect(titles()).toEqual(["Mon Ventoux 2026"]));
    expect(screen.getByText("renommée")).toBeTruthy();
    expect(JSON.parse(window.localStorage.getItem("cyclingos.feed.names.v1"))).toEqual({ r1: "Mon Ventoux 2026" });
    expect(new Map([...root.files].map(([k, v]) => [k, JSON.stringify(v)]))).toEqual(before);

    // un nouveau montage retrouve le nom ; la recherche l'utilise
    cleanup();
    renderFeed(root);
    await waitFor(() => expect(titles()).toEqual(["Mon Ventoux 2026"]));
    fireEvent.change(screen.getByLabelText("Rechercher par nom de sortie"), { target: { value: "ventoux" } });
    expect(titles()).toEqual(["Mon Ventoux 2026"]);
    fireEvent.change(screen.getByLabelText("Rechercher par nom de sortie"), { target: { value: "origine" } });
    expect(screen.getByText(/Aucune sortie ne correspond/)).toBeTruthy();
  });

  it("un nom vide rétablit le nom d'origine ; Échap annule", async () => {
    const root = new MemoryDirectoryHandle();
    await seed(root, [makeActivity("r2", { name: "Original" })]);
    window.localStorage.setItem("cyclingos.feed.names.v1", JSON.stringify({ r2: "Perso" }));
    renderFeed(root);
    fireEvent.click(await screen.findByLabelText("Renommer Perso"));
    fireEvent.keyDown(screen.getByLabelText("Nom de la sortie"), { key: "Escape" });
    expect(titles()).toEqual(["Perso"]);
    fireEvent.click(screen.getByLabelText("Renommer Perso"));
    const input = screen.getByLabelText("Nom de la sortie");
    fireEvent.change(input, { target: { value: "   " } });
    fireEvent.submit(input.closest("form"));
    await waitFor(() => expect(titles()).toEqual(["Original"]));
  });
});

describe("ActivityFeedView — tri, filtres, pagination", () => {
  async function setup() {
    const root = new MemoryDirectoryHandle();
    await seed(root, [
      makeActivity("a", { name: "Alpha", date: "2026-09-01T08:00:00.000Z", distance: 90, elevationGain: 200, sportType: "cycling" }),
      makeActivity("b", { name: "Bravo", date: "2026-09-10T08:00:00.000Z", distance: 20, elevationGain: 1500, sportType: "mtb" }),
      makeActivity("c", { name: "Charlie", date: "2026-09-05T08:00:00.000Z", distance: 55, elevationGain: 700, sportType: "gravel" }),
    ]);
    renderFeed(root);
    await waitFor(() => expect(titles().length).toBe(3));
  }
  it("tri par date (défaut), distance, dénivelé", async () => {
    await setup();
    expect(titles()).toEqual(["Bravo", "Charlie", "Alpha"]);
    const select = screen.getByLabelText("Trier les sorties");
    fireEvent.change(select, { target: { value: "distance" } });
    expect(titles()).toEqual(["Alpha", "Charlie", "Bravo"]);
    fireEvent.change(select, { target: { value: "elevation" } });
    expect(titles()).toEqual(["Bravo", "Charlie", "Alpha"]);
  });
  it("filtre par type d'activité (uniquement les types présents)", async () => {
    await setup();
    const group = screen.getByRole("group", { name: /type d'activité/ });
    expect(within(group).getAllByRole("button").map((b) => b.textContent)).toEqual(["Toutes", "Route", "VTT", "Gravel"]);
    fireEvent.click(within(group).getByText("VTT"));
    expect(titles()).toEqual(["Bravo"]);
    fireEvent.click(within(group).getByText("Toutes"));
    expect(titles().length).toBe(3);
  });
  it("recherche par nom", async () => {
    await setup();
    fireEvent.change(screen.getByLabelText("Rechercher par nom de sortie"), { target: { value: "char" } });
    expect(titles()).toEqual(["Charlie"]);
  });
  it("chargement progressif : 10 par page puis « Afficher plus »", async () => {
    const root = new MemoryDirectoryHandle();
    await seed(root, Array.from({ length: 13 }, (_, i) => makeActivity(`p${i}`, { name: `Sortie ${String(i).padStart(2, "0")}`, date: `2026-09-${String(i + 1).padStart(2, "0")}T08:00:00.000Z` })));
    renderFeed(root);
    await waitFor(() => expect(titles().length).toBe(10));
    fireEvent.click(screen.getByText(/Afficher plus \(3 restantes\)/));
    await waitFor(() => expect(titles().length).toBe(13));
    expect(screen.queryByText(/Afficher plus/)).toBeNull();
  });
});

describe("ActivityFeedView — partage", () => {
  it("ouvre l'aperçu avec les deux formats, les thèmes et les options de confidentialité", async () => {
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(recordingCtx());
    const root = new MemoryDirectoryHandle();
    await seed(root, [makeActivity("s1", { name: "À partager" })]);
    renderFeed(root);
    await waitFor(() => expect(screen.getAllByRole("img", { name: /^Tracé de/ }).length).toBe(1));
    fireEvent.click(screen.getByText("Partager"));

    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByRole("img", { name: /Aperçu story : À partager/ })).toBeTruthy();
    expect(within(dialog).getByText(/Télécharger PNG \(1080×1920\)/)).toBeTruthy();

    fireEvent.click(within(dialog).getByRole("radio", { name: /Carré/ }));
    expect(within(dialog).getByRole("img", { name: /Aperçu carré/ })).toBeTruthy();
    expect(within(dialog).getByText(/Télécharger PNG \(1080×1080\)/)).toBeTruthy();

    expect(within(dialog).getByRole("radio", { name: "Clair" })).toBeTruthy();
    expect(within(dialog).getByLabelText(/Masquer départ et arrivée/).checked).toBe(true);
    fireEvent.click(within(dialog).getByLabelText("Durée"));
    fireEvent.keyDown(window, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("propose Clair / Sombre / Transparent et le format Sticker ; le fond transparent affiche un repère damier et un nom de fichier dédié", async () => {
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(recordingCtx());
    const root = new MemoryDirectoryHandle();
    await seed(root, [makeActivity("s2", { name: "Sortie sticker" })]);
    renderFeed(root);
    await waitFor(() => expect(screen.getAllByRole("img", { name: /^Tracé de/ }).length).toBe(1));
    fireEvent.click(screen.getByText("Partager"));
    const dialog = await screen.findByRole("dialog");

    const bg = within(dialog).getByRole("radiogroup", { name: "Fond de l'image" });
    expect(within(bg).getAllByRole("radio").map((r) => r.textContent)).toEqual(["Sombre", "Clair", "Transparent"]);
    expect(dialog.querySelector(".gpx-share-preview--transparent")).toBeNull();
    fireEvent.click(within(bg).getByRole("radio", { name: "Transparent" }));
    expect(dialog.querySelector(".gpx-share-preview--transparent")).toBeTruthy();
    expect(within(dialog).getByText(/canal alpha/)).toBeTruthy();
    expect(within(dialog).getByText(/le damier n'est qu'un repère d'aperçu/)).toBeTruthy();
    fireEvent.click(within(bg).getByRole("radio", { name: "Clair" }));
    expect(dialog.querySelector(".gpx-share-preview--transparent")).toBeNull();

    fireEvent.click(within(dialog).getByRole("radio", { name: /Sticker/ }));
    expect(within(dialog).getByText(/Télécharger PNG \(1080×1200\)/)).toBeTruthy();
  });
});

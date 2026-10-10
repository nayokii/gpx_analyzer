import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, cleanup, screen, fireEvent, waitFor, within, act } from "@testing-library/react";

import { TerrainView, RETRY_DELAY_MS, RATE_LIMIT_DELAY_MS, RATE_LIMIT_NOTE, UNAVAILABLE_MESSAGE } from "./TerrainView.jsx";
import { memoryStore, planTerrainCells } from "../lib/terrain/index.js";
import { cellBounds } from "../lib/terrain/geo.js";
import { hasOsmConsent, getTypeOverride } from "../lib/terrain/preferences.js";
import { makeTrack, makeWay, overpassResponse } from "../lib/terrain/tests/fixtures.js";

const TRACK = makeTrack({ toM: 3000, grade: 8 });
const ANALYSIS = { series: TRACK };
const ROAD = { highway: "residential", surface: "asphalt" };
const PATH = { highway: "path", "mtb:scale": "2", smoothness: "bad" };
const MIXED_WAYS = [makeWay(1, ROAD, { toM: 1000 }), makeWay(2, { highway: "track", tracktype: "grade2" }, { fromM: 1000, toM: 2000 }), makeWay(3, PATH, { fromM: 2000, toM: 3000 })];

function cachedStore(ways) {
  const store = memoryStore();
  for (const key of planTerrainCells(TRACK).cellKeys) store._map.set(key, { fetchedAt: Date.now(), ways });
  return store;
}
const okFetch = (ways) => vi.fn(async () => ({ ok: true, status: 200, json: async () => overpassResponse(ways) }));

beforeEach(() => localStorage.clear());
afterEach(() => { cleanup(); localStorage.clear(); });

describe("TerrainView — sans autorisation ni cache (hors ligne par défaut)", () => {
  it("affiche « Indéterminé », une couverture nulle, et aucune requête réseau", async () => {
    const fetchImpl = vi.fn();
    render(<TerrainView analysis={ANALYSIS} activityKey="k1" store={memoryStore()} fetchImpl={fetchImpl} />);
    expect(await screen.findByText("Indéterminé")).toBeTruthy();
    expect(screen.getByText("couverture cartographique")).toBeTruthy();
    expect(screen.getByText("Données insuffisantes")).toBeTruthy(); // difficulté : pas de note trompeuse
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("demande l'autorisation avant tout envoi ; « Pas maintenant » ne fait aucune requête", async () => {
    const fetchImpl = vi.fn();
    render(<TerrainView analysis={ANALYSIS} activityKey="k1" store={memoryStore()} fetchImpl={fetchImpl} />);
    fireEvent.click(await screen.findByText("Analyser le terrain"));
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText(/Jamais envoyés/)).toBeTruthy();
    expect(within(dialog).getByText(/overpass-api.de/)).toBeTruthy();
    fireEvent.click(screen.getByText("Pas maintenant"));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(hasOsmConsent()).toBe(false);
  });

  it("après autorisation : requêtes par zone, résultat mixte avec répartition, difficulté, facteurs et confiance", async () => {
    const fetchImpl = okFetch(MIXED_WAYS);
    render(<TerrainView analysis={ANALYSIS} activityKey="k1" store={memoryStore()} fetchImpl={fetchImpl} minIntervalMs={0} cellsPerRequest={1} />);
    fireEvent.click(await screen.findByText("Analyser le terrain"));
    fireEvent.click(screen.getByText("Autoriser et analyser"));

    expect(await screen.findByText("Mixte", { selector: ".gpx-terrain-type" }, { timeout: 5000 })).toBeTruthy();
    expect(hasOsmConsent()).toBe(true);
    expect(fetchImpl).toHaveBeenCalled();
    // les requêtes ne contiennent que des rectangles, jamais le tracé
    for (const [, init] of fetchImpl.mock.calls) expect(decodeURIComponent(init.body)).not.toMatch(/poly:|around/);

    const legend = screen.getByText("Route", { selector: ".gpx-terrain-legend-label" }).closest("li");
    expect(legend.textContent).toMatch(/1,0 km/);
    expect(screen.getByText("Pistes et chemins", { selector: ".gpx-terrain-legend-label" }).closest("li").textContent).toMatch(/1,0 km/);
    expect(screen.getByText("Sentiers", { selector: ".gpx-terrain-legend-label" }).closest("li").textContent).toMatch(/1,0 km/);

    expect(screen.getByText(/\/100/)).toBeTruthy();
    expect(screen.getByText(/Confiance (faible|moyenne|élevée)/)).toBeTruthy();
    expect(screen.getByText(/Échelle VTT \(mtb:scale\)/)).toBeTruthy();
    expect(screen.getByText(/Racines, pierres/)).toBeTruthy(); // limites toujours visibles
  });

  it("erreur réseau : service signalé indisponible, zones non classifiées, aucune donnée inventée, pas de plantage", async () => {
    localStorage.setItem("gpx-terrain-osm-consent", "granted");
    const fetchImpl = vi.fn(async () => { throw new TypeError("Failed to fetch"); });
    render(<TerrainView analysis={ANALYSIS} activityKey="k1" store={memoryStore()} fetchImpl={fetchImpl} minIntervalMs={0} cellsPerRequest={1} />);
    fireEvent.click(await screen.findByText("Charger les données cartographiques"));
    expect(await screen.findByText(/temporairement indisponible/)).toBeTruthy();
    expect(screen.getByText("Indéterminé", { selector: ".gpx-terrain-type" })).toBeTruthy();
    expect(screen.getByText("Données insuffisantes")).toBeTruthy();
  });
});

describe("TerrainView — données locales (cache) sans connexion", () => {
  it("utilise le cache sans aucune requête : tracé routier → « Route », difficulté non applicable", async () => {
    const fetchImpl = vi.fn();
    render(<TerrainView analysis={ANALYSIS} activityKey="k2" store={cachedStore([makeWay(1, ROAD, { toM: 3000 })])} fetchImpl={fetchImpl} />);
    expect(await screen.findByText("Route", { selector: ".gpx-terrain-type" })).toBeTruthy();
    expect(screen.getByText("Non applicable")).toBeTruthy();
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(screen.queryByText("Analyser le terrain")).toBeNull(); // rien à charger
  });

  it("tracé forestier sur piste → « VTT chemins/pistes »", async () => {
    render(<TerrainView analysis={ANALYSIS} activityKey="k3" store={cachedStore([makeWay(1, { highway: "track", tracktype: "grade3", surface: "gravel" }, { toM: 3000 })])} />);
    expect(await screen.findByText("VTT chemins/pistes", { selector: ".gpx-terrain-type" })).toBeTruthy();
  });

  it("correction manuelle du type : enregistrée, n'altère ni la répartition ni la difficulté", async () => {
    render(<TerrainView analysis={ANALYSIS} activityKey="k4" store={cachedStore([makeWay(3, PATH, { toM: 3000 })])} />);
    expect(await screen.findByText("VTT sentiers", { selector: ".gpx-terrain-type" })).toBeTruthy();
    const scoreBefore = screen.getByText(/\/100/).parentElement.textContent;
    const legendBefore = screen.getByText("Sentiers", { selector: ".gpx-terrain-legend-label" }).closest("li").textContent;

    fireEvent.change(screen.getByLabelText("Type de terrain"), { target: { value: "road" } });
    await waitFor(() => expect(screen.getByText("Route", { selector: ".gpx-terrain-type" })).toBeTruthy());
    expect(screen.getByText("Type corrigé manuellement")).toBeTruthy();
    expect(getTypeOverride("k4")).toBe("road");
    expect(screen.getByText(/\/100/).parentElement.textContent).toBe(scoreBefore);
    expect(screen.getByText("Sentiers", { selector: ".gpx-terrain-legend-label" }).closest("li").textContent).toBe(legendBefore);

    fireEvent.change(screen.getByLabelText("Type de terrain"), { target: { value: "auto" } });
    await waitFor(() => expect(screen.getByText("VTT sentiers", { selector: ".gpx-terrain-type" })).toBeTruthy());
    expect(getTypeOverride("k4")).toBeNull();
  });

  it("retirer l'autorisation et vider le cache fonctionnent", async () => {
    localStorage.setItem("gpx-terrain-osm-consent", "granted");
    const store = cachedStore([makeWay(1, ROAD, { toM: 3000 })]);
    render(<TerrainView analysis={ANALYSIS} activityKey="k5" store={store} />);
    await screen.findByText("Route", { selector: ".gpx-terrain-type" });
    fireEvent.click(screen.getByText("Retirer l'autorisation des requêtes"));
    expect(hasOsmConsent()).toBe(false);
    fireEvent.click(screen.getByText(/Vider le cache cartographique/));
    expect(await screen.findByText("Indéterminé", { selector: ".gpx-terrain-type" })).toBeTruthy();
  });
});

describe("TerrainView — GPS absent", () => {
  it("explique que le terrain ne peut pas être analysé", () => {
    render(<TerrainView analysis={{ series: [{ lat: null, lon: null }] }} activityKey="k6" store={memoryStore()} />);
    expect(screen.getByText(/pas de coordonnées GPS exploitables/)).toBeTruthy();
  });
});

describe("TerrainView — service Overpass indisponible, relance manuelle", () => {
  const KEYS = planTerrainCells(TRACK).cellKeys; // 6 zones pour ce tracé
  const failing = (status = 503) => vi.fn(async () => ({ ok: false, status, headers: { get: () => null } }));
  const bodyBox = (init) => decodeURIComponent(init.body).match(/-?\d+\.\d{5}/g).join(",");
  const boxOf = (key) => { const b = cellBounds(key); return [b.south, b.west, b.north, b.east].map((v) => v.toFixed(5)).join(","); };
  // Cache frais pour toutes les zones SAUF les deux dernières : seules elles seront demandées.
  function partlyCachedStore() {
    const store = memoryStore();
    for (const key of KEYS.slice(0, -2)) store._map.set(key, { fetchedAt: Date.now(), ways: [] });
    return store;
  }
  const grant = () => localStorage.setItem("gpx-terrain-osm-consent", "granted");
  const loadButton = () => screen.findByText("Charger les données cartographiques");

  beforeEach(() => vi.useFakeTimers({ shouldAdvanceTime: true }));
  afterEach(() => vi.useRealTimers());

  it("affiche le bandeau d'indisponibilité avec le texte exact et un bouton « Réessayer »", async () => {
    grant();
    const fetchImpl = failing(503);
    render(<TerrainView analysis={ANALYSIS} activityKey="u1" store={memoryStore()} fetchImpl={fetchImpl} minIntervalMs={0} cellsPerRequest={1} />);
    fireEvent.click(await loadButton());
    const banner = await screen.findByRole("alert");
    expect(banner.textContent).toContain(UNAVAILABLE_MESSAGE);
    expect(UNAVAILABLE_MESSAGE).toBe("Service cartographique (OpenStreetMap / Overpass) temporairement indisponible. Aucune nouvelle requête n'est lancée automatiquement. Les portions non chargées restent non classifiées.");
    expect(within(banner).getByText("Réessayer")).toBeTruthy();
    expect(screen.getByText("Indéterminé", { selector: ".gpx-terrain-type" })).toBeTruthy();
    expect(fetchImpl.mock.calls.length).toBeLessThanOrEqual(4); // arrêt anticipé : 6 zones, 4 requêtes au plus
    expect(screen.queryByText("Charger les données cartographiques")).toBeNull(); // la relance passe uniquement par « Réessayer »
  });

  it("aucune requête automatique pendant l'attente ; la relance n'a lieu qu'après 15 s et une seule fois (clics répétés ignorés)", async () => {
    grant();
    expect(RETRY_DELAY_MS).toBe(15000);
    let phase = "down";
    const fetchImpl = vi.fn(async () => (phase === "down" ? { ok: false, status: 503, headers: { get: () => null } } : { ok: true, status: 200, json: async () => overpassResponse([]) }));
    render(<TerrainView analysis={ANALYSIS} activityKey="u2" store={partlyCachedStore()} fetchImpl={fetchImpl} minIntervalMs={0} cellsPerRequest={1} />);
    fireEvent.click(await loadButton());
    await screen.findByRole("alert");
    const callsAfterFailure = fetchImpl.mock.calls.length;
    expect(callsAfterFailure).toBe(4); // 2 zones à charger × (serveur principal + secours), puis arrêt
    phase = "up";

    const retry = screen.getByText("Réessayer").closest("button");
    fireEvent.click(retry);
    expect(await screen.findByText(/Nouvelle tentative dans 1[45] s/)).toBeTruthy();
    expect(screen.getByText(/Nouvelle tentative dans/).closest("button").disabled).toBe(true);
    fireEvent.click(screen.getByText(/Nouvelle tentative dans/)); // clic répété : ignoré (bouton désactivé)
    fireEvent.click(screen.getByText(/Nouvelle tentative dans/));

    await act(async () => { await vi.advanceTimersByTimeAsync(10000); });
    expect(fetchImpl).toHaveBeenCalledTimes(callsAfterFailure); // rien pendant l'attente
    await act(async () => { await vi.advanceTimersByTimeAsync(5500); });
    await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
    await act(async () => { await vi.advanceTimersByTimeAsync(30000); });
    expect(fetchImpl.mock.calls.length - callsAfterFailure).toBe(2); // exactement les 2 zones restantes, une seule fois
  });

  it("ne relance que les zones en échec ou différées : jamais celles du cache ni celles déjà chargées", async () => {
    grant();
    const seen = [];
    let up = false;
    const fetchImpl = vi.fn(async (url, init) => {
      seen.push(bodyBox(init));
      return up ? { ok: true, status: 200, json: async () => overpassResponse([]) } : { ok: false, status: 503, headers: { get: () => null } };
    });
    render(<TerrainView analysis={ANALYSIS} activityKey="u3" store={partlyCachedStore()} fetchImpl={fetchImpl} minIntervalMs={0} cellsPerRequest={1} />);
    fireEvent.click(await loadButton());
    await screen.findByRole("alert");
    const wanted = new Set(KEYS.slice(-2).map(boxOf));
    expect(seen.length).toBeGreaterThan(0);
    for (const box of seen) expect(wanted.has(box)).toBe(true); // jamais une zone déjà en cache

    seen.length = 0;
    up = true;
    fireEvent.click(screen.getByText("Réessayer"));
    await act(async () => { await vi.advanceTimersByTimeAsync(16000); });
    await waitFor(() => expect(seen.length).toBe(2));
    expect(new Set(seen)).toEqual(wanted);
    await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
  });

  it("zones différées : après une panne totale sur 6 zones, la relance les charge toutes (budget neuf) sans doublon", async () => {
    grant();
    let up = false;
    const seen = [];
    const fetchImpl = vi.fn(async (url, init) => {
      seen.push(bodyBox(init));
      return up ? { ok: true, status: 200, json: async () => overpassResponse([]) } : { ok: false, status: 503, headers: { get: () => null } };
    });
    render(<TerrainView analysis={ANALYSIS} activityKey="u4" store={memoryStore()} fetchImpl={fetchImpl} minIntervalMs={0} cellsPerRequest={1} />);
    fireEvent.click(await loadButton());
    await screen.findByRole("alert");
    expect(fetchImpl.mock.calls.length).toBeLessThanOrEqual(4);
    seen.length = 0;
    up = true;
    fireEvent.click(screen.getByText("Réessayer"));
    await act(async () => { await vi.advanceTimersByTimeAsync(16000); });
    await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
    expect(seen.length).toBe(KEYS.length);
    expect(new Set(seen)).toEqual(new Set(KEYS.map(boxOf)));
  });

  it("« Réessayer » ne contourne pas le consentement : après retrait de l'autorisation, la demande est reposée et rien n'est envoyé", async () => {
    grant();
    const fetchImpl = failing(503);
    render(<TerrainView analysis={ANALYSIS} activityKey="u5" store={partlyCachedStore()} fetchImpl={fetchImpl} minIntervalMs={0} cellsPerRequest={1} />);
    fireEvent.click(await loadButton());
    await screen.findByRole("alert");
    const before = fetchImpl.mock.calls.length;

    fireEvent.click(screen.getByText("Retirer l'autorisation des requêtes"));
    expect(hasOsmConsent()).toBe(false);
    fireEvent.click(screen.getByText("Réessayer"));
    expect(screen.getByRole("dialog", { name: /Autorisation des requêtes cartographiques/ })).toBeTruthy();
    await act(async () => { await vi.advanceTimersByTimeAsync(60000); });
    expect(fetchImpl).toHaveBeenCalledTimes(before);
    fireEvent.click(screen.getByText("Pas maintenant"));
    await act(async () => { await vi.advanceTimersByTimeAsync(60000); });
    expect(fetchImpl).toHaveBeenCalledTimes(before);
  });

  it("retirer l'autorisation PENDANT l'attente annule la relance programmée", async () => {
    grant();
    const fetchImpl = failing(503);
    render(<TerrainView analysis={ANALYSIS} activityKey="u6" store={partlyCachedStore()} fetchImpl={fetchImpl} minIntervalMs={0} cellsPerRequest={1} />);
    fireEvent.click(await loadButton());
    await screen.findByRole("alert");
    const before = fetchImpl.mock.calls.length;
    fireEvent.click(screen.getByText("Réessayer"));
    await screen.findByText(/Nouvelle tentative dans/);
    fireEvent.click(screen.getByText("Retirer l'autorisation des requêtes"));
    await act(async () => { await vi.advanceTimersByTimeAsync(60000); });
    expect(fetchImpl).toHaveBeenCalledTimes(before);
    expect(screen.queryByText(/Nouvelle tentative dans/)).toBeNull();
  });

  it("démontage pendant l'attente : aucune requête ensuite, aucune erreur", async () => {
    grant();
    const fetchImpl = failing(503);
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const { unmount } = render(<TerrainView analysis={ANALYSIS} activityKey="u7" store={partlyCachedStore()} fetchImpl={fetchImpl} minIntervalMs={0} cellsPerRequest={1} />);
    fireEvent.click(await loadButton());
    await screen.findByRole("alert");
    const before = fetchImpl.mock.calls.length;
    fireEvent.click(screen.getByText("Réessayer"));
    await screen.findByText(/Nouvelle tentative dans/);
    unmount();
    await act(async () => { await vi.advanceTimersByTimeAsync(60000); });
    expect(fetchImpl).toHaveBeenCalledTimes(before);
    expect(errors).not.toHaveBeenCalled();
    errors.mockRestore();
  });

  it("sans consentement : aucune requête à l'ouverture, ni après un clic sur « Pas maintenant » (aucun chemin réseau sans autorisation)", async () => {
    const fetchImpl = failing(503);
    render(<TerrainView analysis={ANALYSIS} activityKey="u8" store={memoryStore()} fetchImpl={fetchImpl} minIntervalMs={0} cellsPerRequest={1} />);
    fireEvent.click(await screen.findByText("Analyser le terrain"));
    fireEvent.click(screen.getByText("Pas maintenant"));
    await act(async () => { await vi.advanceTimersByTimeAsync(60000); });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("le consentement informe sur l'adresse IP et la région approximative, et sur ce qui n'est jamais envoyé", async () => {
    render(<TerrainView analysis={ANALYSIS} activityKey="u9" store={memoryStore()} fetchImpl={vi.fn()} />);
    fireEvent.click(await screen.findByText("Analyser le terrain"));
    const dialog = screen.getByRole("dialog");
    expect(dialog.textContent).toMatch(/adresse IP/);
    expect(dialog.textContent).toMatch(/région approximative/);
    expect(dialog.textContent).toMatch(/Jamais envoyés : le fichier GPX\/FIT, le tracé exact/);
  });

  it("les requêtes d'un chargement autorisé ne contiennent que des boîtes englobantes (aucun point du tracé)", async () => {
    grant();
    const fetchImpl = vi.fn(async () => ({ ok: true, status: 200, json: async () => overpassResponse([]) }));
    render(<TerrainView analysis={ANALYSIS} activityKey="u10" store={memoryStore()} fetchImpl={fetchImpl} minIntervalMs={0} cellsPerRequest={1} />);
    fireEvent.click(await loadButton());
    await waitFor(() => expect(fetchImpl.mock.calls.length).toBe(KEYS.length));
    const boxes = new Set(KEYS.map(boxOf));
    for (const [, init] of fetchImpl.mock.calls) expect(boxes.has(bodyBox(init))).toBe(true);
  });
});

describe("TerrainView — délai imposé après un 429, persistance et regroupement", () => {
  const KEYS = planTerrainCells(TRACK).cellKeys; // 6 zones
  const rateLimited = (retryAfter = null) => vi.fn(async () => ({ ok: false, status: 429, headers: { get: (h) => (h === "Retry-After" ? retryAfter : null) } }));
  const down = (status = 503) => vi.fn(async () => ({ ok: false, status, headers: { get: () => null } }));
  const ok = () => vi.fn(async () => ({ ok: true, status: 200, json: async () => overpassResponse([]) }));
  const grant = () => localStorage.setItem("gpx-terrain-osm-consent", "granted");
  const COOLDOWN_KEY = "gpx-terrain-overpass-cooldown-until";
  const loadBtn = () => screen.findByText("Charger les données cartographiques");
  const tick = (ms) => act(async () => { await vi.advanceTimersByTimeAsync(ms); });

  beforeEach(() => vi.useFakeTimers({ shouldAdvanceTime: true }));
  afterEach(() => vi.useRealTimers());

  it("après un 429 : note explicite, puis AUCUNE requête avant 30 s ; la relance part ensuite, une seule fois", async () => {
    grant();
    const fetchImpl = rateLimited();
    render(<TerrainView analysis={ANALYSIS} activityKey="c1" store={memoryStore()} fetchImpl={fetchImpl} minIntervalMs={0} cellsPerRequest={1} />);
    fireEvent.click(await loadBtn());
    const banner = await screen.findByRole("alert");
    expect(banner.textContent).toContain(UNAVAILABLE_MESSAGE);
    expect(banner.textContent).toContain(RATE_LIMIT_NOTE);
    expect(fetchImpl).toHaveBeenCalledTimes(2); // 429 : principal + secours pour la première zone, puis arrêt immédiat
    const stored = Number(localStorage.getItem(COOLDOWN_KEY));
    expect(stored - Date.now()).toBeGreaterThan(RATE_LIMIT_DELAY_MS - 2000);

    fireEvent.click(screen.getByText("Réessayer"));
    expect(await screen.findByText(/Nouvelle tentative dans (29|30) s/)).toBeTruthy();
    await tick(RATE_LIMIT_DELAY_MS - 2000); // 28 s : toujours rien
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    await tick(3000); // > 30 s
    await waitFor(() => expect(fetchImpl.mock.calls.length).toBeGreaterThan(2));
  });

  it("le délai après un 429 est de 30 s, pas de 15 s : à 16 s la relance n'est PAS partie", async () => {
    grant();
    const fetchImpl = rateLimited();
    render(<TerrainView analysis={ANALYSIS} activityKey="c2" store={memoryStore()} fetchImpl={fetchImpl} minIntervalMs={0} cellsPerRequest={1} />);
    fireEvent.click(await loadBtn());
    await screen.findByRole("alert");
    const before = fetchImpl.mock.calls.length;
    fireEvent.click(screen.getByText("Réessayer"));
    await tick(16000);
    expect(fetchImpl).toHaveBeenCalledTimes(before);
    expect(screen.getByText(/Nouvelle tentative dans/)).toBeTruthy();
  });

  it("un Retry-After supérieur à 30 s annoncé par le service est respecté (ici 45 s)", async () => {
    grant();
    const fetchImpl = rateLimited("45");
    render(<TerrainView analysis={ANALYSIS} activityKey="c3" store={memoryStore()} fetchImpl={fetchImpl} minIntervalMs={0} cellsPerRequest={1} />);
    fireEvent.click(await loadBtn());
    await screen.findByRole("alert");
    expect(Number(localStorage.getItem(COOLDOWN_KEY)) - Date.now()).toBeGreaterThan(43000);
  });

  it("une panne sans 429 (503) garde le délai court de 15 s et n'affiche pas la note de limite de débit", async () => {
    grant();
    const fetchImpl = down(503);
    render(<TerrainView analysis={ANALYSIS} activityKey="c4" store={memoryStore()} fetchImpl={fetchImpl} minIntervalMs={0} cellsPerRequest={1} />);
    fireEvent.click(await loadBtn());
    const banner = await screen.findByRole("alert");
    expect(banner.textContent).not.toContain(RATE_LIMIT_NOTE);
    const stored = Number(localStorage.getItem(COOLDOWN_KEY)) - Date.now();
    expect(stored).toBeLessThanOrEqual(RETRY_DELAY_MS);
    expect(stored).toBeGreaterThan(RETRY_DELAY_MS - 2000);
  });

  it("l'attente survit au démontage : rouvrir l'onglet et cliquer « Charger… » ne contourne pas le délai", async () => {
    grant();
    const first = rateLimited();
    const view = render(<TerrainView analysis={ANALYSIS} activityKey="c5" store={memoryStore()} fetchImpl={first} minIntervalMs={0} cellsPerRequest={1} />);
    fireEvent.click(await loadBtn());
    await screen.findByRole("alert");
    view.unmount();

    const second = ok();
    render(<TerrainView analysis={ANALYSIS} activityKey="c5" store={memoryStore()} fetchImpl={second} minIntervalMs={0} cellsPerRequest={1} />);
    fireEvent.click(await loadBtn()); // nouveau montage : plus de bandeau, bouton normal
    expect(await screen.findByText(/Nouvelle tentative dans (29|30) s/)).toBeTruthy();
    expect(second).not.toHaveBeenCalled();
    await tick(20000);
    expect(second).not.toHaveBeenCalled();
    await tick(11000);
    await waitFor(() => expect(second).toHaveBeenCalled());
  });

  it("le délai s'applique aussi au chemin « Autoriser et analyser » : l'autorisation ne permet pas de le contourner", async () => {
    localStorage.setItem(COOLDOWN_KEY, String(Date.now() + 20000));
    const fetchImpl = ok();
    render(<TerrainView analysis={ANALYSIS} activityKey="c6" store={memoryStore()} fetchImpl={fetchImpl} minIntervalMs={0} cellsPerRequest={1} />);
    fireEvent.click(await screen.findByText("Analyser le terrain"));
    fireEvent.click(screen.getByText("Autoriser et analyser"));
    expect(await screen.findByText(/Nouvelle tentative dans/)).toBeTruthy();
    expect(fetchImpl).not.toHaveBeenCalled();
    await tick(21000);
    await waitFor(() => expect(fetchImpl).toHaveBeenCalled());
  });

  it("un chargement sans incident efface l'attente", async () => {
    grant();
    localStorage.setItem(COOLDOWN_KEY, String(Date.now() - 1000)); // échéance déjà passée
    const fetchImpl = ok();
    render(<TerrainView analysis={ANALYSIS} activityKey="c7" store={memoryStore()} fetchImpl={fetchImpl} minIntervalMs={0} cellsPerRequest={1} />);
    fireEvent.click(await loadBtn());
    await waitFor(() => expect(fetchImpl.mock.calls.length).toBe(KEYS.length));
    await waitFor(() => expect(localStorage.getItem(COOLDOWN_KEY)).toBeNull());
  });

  it("l'analyse locale à l'ouverture n'est jamais soumise au délai et ne lance aucune requête", async () => {
    grant();
    localStorage.setItem(COOLDOWN_KEY, String(Date.now() + 60000));
    const fetchImpl = ok();
    render(<TerrainView analysis={ANALYSIS} activityKey="c8" store={memoryStore()} fetchImpl={fetchImpl} minIntervalMs={0} />);
    expect(await screen.findByText("Indéterminé", { selector: ".gpx-terrain-type" })).toBeTruthy();
    await tick(120000);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("regroupement par défaut : 6 zones saines = 2 requêtes (3 + 3), bornes seulement", async () => {
    grant();
    const fetchImpl = ok();
    render(<TerrainView analysis={ANALYSIS} activityKey="c9" store={memoryStore()} fetchImpl={fetchImpl} minIntervalMs={0} />);
    fireEvent.click(await loadBtn());
    await waitFor(() => expect(fetchImpl).toHaveBeenCalledTimes(2));
    const allowed = new Set(KEYS.flatMap((k) => { const b = cellBounds(k); return [b.south, b.west, b.north, b.east].map((v) => v.toFixed(5)); }));
    for (const [, init] of fetchImpl.mock.calls) {
      const nums = decodeURIComponent(init.body).match(/-?\d+\.\d{5}/g);
      expect(nums).toHaveLength(12);
      for (const n of nums) expect(allowed.has(n)).toBe(true);
    }
  });
});

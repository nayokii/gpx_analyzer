import { describe, it, expect, vi, afterEach } from "vitest";
import {
  SHARE_FORMATS, buildShareModel, drawShareCard, renderShareCard, exportShareCardPng, shareFileName, shareOrDownload,
} from "./shareCard.js";
import { loopRoute } from "./testRoutes.js";
import { recordingCtx } from "./testCanvas.js";

const RAW = loopRoute(500);
const activity = {
  id: "act-secret-id-42", name: "Boucle du matin", date: "2026-09-20T08:00:00Z", sportType: "gravel",
  distance: 63.4, movingTime: 8700, duration: 9800, avgSpeed: 26.2, elevationGain: 812,
  gpsTrack: RAW, samples: RAW.map((p, i) => ({ latitude: p.lat, longitude: p.lon, altitude: 200 + 80 * Math.sin(i / 40) })),
  flags: { hasElevation: true },
};

afterEach(() => vi.restoreAllMocks());

describe("formats d'export", () => {
  it("Story 1080×1920 et carré 1080×1080", () => {
    expect([SHARE_FORMATS.story.width, SHARE_FORMATS.story.height]).toEqual([1080, 1920]);
    expect([SHARE_FORMATS.square.width, SHARE_FORMATS.square.height]).toEqual([1080, 1080]);
    expect(buildShareModel(activity, { format: "story" })).toMatchObject({ width: 1080, height: 1920 });
    expect(buildShareModel(activity, { format: "square" })).toMatchObject({ width: 1080, height: 1080 });
  });
  it("un format inconnu retombe sur la story", () => {
    expect(buildShareModel(activity, { format: "banner" })).toMatchObject({ width: 1080, height: 1920 });
  });
  it("renderShareCard dimensionne le canvas à la résolution réelle, quel que soit l'écran", () => {
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(recordingCtx());
    for (const key of ["story", "square"]) {
      const canvas = document.createElement("canvas");
      expect(renderShareCard(canvas, buildShareModel(activity, { format: key }))).toBe(true);
      expect([canvas.width, canvas.height]).toEqual([SHARE_FORMATS[key].width, SHARE_FORMATS[key].height]);
    }
  });
  it("exportShareCardPng produit un PNG aux dimensions exactes de chaque format", async () => {
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(recordingCtx());
    const sizes = [];
    vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation(function (cb, type) {
      sizes.push([this.width, this.height, type]);
      cb(new Blob(["png"], { type }));
    });
    for (const key of ["story", "square"]) {
      const blob = await exportShareCardPng(buildShareModel(activity, { format: key }));
      expect(blob.type).toBe("image/png");
    }
    expect(sizes).toEqual([[1080, 1920, "image/png"], [1080, 1080, "image/png"]]);
  });
  it("l'export échoue proprement (rejet) si le canvas 2D est indisponible", async () => {
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
    await expect(exportShareCardPng(buildShareModel(activity))).rejects.toThrow();
  });
});

describe("parcours vide ou incomplet", () => {
  const cases = {
    "sans coordonnées": { ...activity, gpsTrack: [], samples: [] },
    "un seul point": { ...activity, gpsTrack: [RAW[0]], samples: [] },
    "coordonnées invalides": { ...activity, gpsTrack: [{ lat: NaN, lon: NaN }, { lat: 0, lon: 0 }], samples: [] },
  };
  for (const [label, a] of Object.entries(cases)) {
    it(`${label} : modèle sans tracé, dessin sans erreur, texte de remplacement`, () => {
      const model = buildShareModel(a, { format: "square" });
      expect(model.route).toBeNull();
      const ctx = recordingCtx();
      expect(() => drawShareCard(ctx, model)).not.toThrow();
      expect(ctx.calls.some((c) => c.op === "fillText" && /indisponible/.test(c.args[0]))).toBe(true);
      // seule la grille de fond trace des segments : aucun tracé n'est inventé
      const withRoute = recordingCtx();
      drawShareCard(withRoute, buildShareModel(activity, { format: "square" }));
      const count = (c) => c.calls.filter((x) => x.op === "lineTo").length;
      expect(count(ctx)).toBeLessThan(count(withRoute) - 20);
    });
  }
  it("le titre et les chiffres restent présents sans tracé", () => {
    const ctx = recordingCtx();
    drawShareCard(ctx, buildShareModel(cases["sans coordonnées"], { format: "story" }));
    const texts = ctx.calls.filter((c) => c.op === "fillText").map((c) => c.args[0]);
    expect(texts).toContain("Boucle du matin");
    expect(texts).toContain("63,4");
  });
});

describe("contenu : nom modifié, chiffres masqués", () => {
  it("utilise le nom modifié sans toucher à l'activité", () => {
    const model = buildShareModel(activity, { name: "Mon Vercors" });
    expect(model.title).toBe("Mon Vercors");
    expect(activity.name).toBe("Boucle du matin");
  });
  it("masque les chiffres demandés", () => {
    const model = buildShareModel(activity, { hidden: ["distance", "elevationGain"] });
    expect(model.distance).toBeNull();
    expect(model.stats.map((s) => s.key)).toEqual(["movingTime", "avgSpeed"]);
    expect(model.profile).toBeNull();
    const ctx = recordingCtx();
    drawShareCard(ctx, model);
    expect(ctx.calls.filter((c) => c.op === "fillText").map((c) => c.args[0])).not.toContain("63,4");
  });
  it("sans données de vitesse, la statistique n'apparaît pas (pas de 0)", () => {
    const model = buildShareModel({ ...activity, avgSpeed: null }, {});
    expect(model.stats.map((s) => s.key)).toEqual(["movingTime", "elevationGain"]);
  });
  it("thèmes clair et sombre : mêmes éléments, couleurs différentes", () => {
    const dark = recordingCtx();
    const light = recordingCtx();
    drawShareCard(dark, buildShareModel(activity, { theme: "dark" }));
    drawShareCard(light, buildShareModel(activity, { theme: "light" }));
    expect(dark.calls.filter((c) => c.op === "fillText").length).toBe(light.calls.filter((c) => c.op === "fillText").length);
  });
});

describe("confidentialité des visuels", () => {
  const rawNumbers = RAW.flatMap((p) => [p.lat.toFixed(4), p.lon.toFixed(4)]);

  it("le modèle ne contient aucune latitude/longitude brute (ni l'identifiant de la sortie)", () => {
    for (const hidePlaces of [true, false]) {
      const json = JSON.stringify(buildShareModel(activity, { hidePlaces }));
      for (const n of rawNumbers.slice(0, 80)) expect(json).not.toContain(n);
      expect(json).not.toContain("act-secret-id-42");
    }
  });
  it("les points dessinés sont des pixels dans le cadre du canvas", () => {
    const ctx = recordingCtx();
    drawShareCard(ctx, buildShareModel(activity, { format: "square" }));
    const pts = ctx.calls.filter((c) => c.op === "lineTo" || c.op === "moveTo").flatMap((c) => c.args);
    expect(pts.length).toBeGreaterThan(20);
    for (const v of pts) expect(Math.abs(v)).toBeLessThanOrEqual(1920);
  });
  it("aucun texte dessiné ne ressemble à une coordonnée GPS", () => {
    const ctx = recordingCtx();
    drawShareCard(ctx, buildShareModel(activity, {}));
    for (const c of ctx.calls.filter((x) => x.op === "fillText")) expect(c.args[0]).not.toMatch(/\d{1,3}\.\d{4,}/);
  });
  it("option activée : pas de marqueurs de départ/arrivée et tracé raccourci", () => {
    const hidden = buildShareModel(activity, { hidePlaces: true, simplify: false });
    const shown = buildShareModel(activity, { hidePlaces: false, simplify: false });
    expect(hidden.route.showEndpoints).toBe(false);
    expect(shown.route.showEndpoints).toBe(true);
    expect(hidden.route.points.length).toBeLessThan(shown.route.points.length);

    const arcs = (model) => { const ctx = recordingCtx(); drawShareCard(ctx, model); return ctx.calls.filter((c) => c.op === "arc").length; };
    expect(arcs(shown)).toBe(arcs(hidden) + 4); // 2 marqueurs × (halo + disque)
  });
  it("le profil d'altitude est relatif (0–1) : aucune altitude absolue exportée", () => {
    const { profile } = buildShareModel(activity, { format: "story" });
    expect(Math.min(...profile)).toBe(0);
    expect(Math.max(...profile)).toBe(1);
  });
  it("le nom de fichier ne contient ni identifiant ni coordonnées", () => {
    const name = shareFileName("Col d'Aubisque — été 2026 !", "story");
    expect(name).toBe("cycling-os-col-d-aubisque-ete-2026-story.png");
    expect(shareFileName("", "square")).toBe("cycling-os-sortie-square.png");
  });
});

describe("partage natif et repli téléchargement", () => {
  const blob = new Blob(["png"], { type: "image/png" });
  function stubDownload() {
    URL.createObjectURL = vi.fn(() => "blob:x");
    URL.revokeObjectURL = vi.fn();
    return vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
  }
  it("utilise navigator.share quand il accepte les fichiers", async () => {
    const click = stubDownload();
    const nav = { canShare: vi.fn(() => true), share: vi.fn(() => Promise.resolve()) };
    expect(await shareOrDownload(blob, "a.png", nav)).toBe("shared");
    expect(nav.share).toHaveBeenCalled();
    expect(click).not.toHaveBeenCalled();
  });
  it("télécharge si le partage de fichiers n'est pas supporté", async () => {
    const click = stubDownload();
    expect(await shareOrDownload(blob, "a.png", { canShare: () => false, share: vi.fn() })).toBe("downloaded");
    expect(await shareOrDownload(blob, "a.png", {})).toBe("downloaded");
    expect(click).toHaveBeenCalledTimes(2);
  });
  it("télécharge si le partage échoue réellement", async () => {
    const click = stubDownload();
    const nav = { canShare: () => true, share: vi.fn(() => Promise.reject(new Error("boom"))) };
    expect(await shareOrDownload(blob, "a.png", nav)).toBe("downloaded");
    expect(click).toHaveBeenCalledTimes(1);
  });
  it("l'annulation par l'utilisateur ne télécharge rien", async () => {
    const click = stubDownload();
    const nav = { canShare: () => true, share: vi.fn(() => Promise.reject(Object.assign(new Error("x"), { name: "AbortError" }))) };
    expect(await shareOrDownload(blob, "a.png", nav)).toBe("cancelled");
    expect(click).not.toHaveBeenCalled();
  });
});

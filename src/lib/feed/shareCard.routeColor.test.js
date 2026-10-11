/**
 * Couleur du tracé GPS sur les images exportées : rose de marque Cycling OS (#D6116B) sur tous les fonds.
 * Le moteur de rendu partageable a sa propre palette (SHARE_THEMES) ; ce test verrouille qu'elle ne dérive pas
 * vers l'ancien turquoise, et relit un VRAI PNG pour s'assurer que le rose est bien celui qui est dessiné.
 */
import { describe, it, expect } from "vitest";
import { createCanvas, loadImage } from "@napi-rs/canvas";
import { SHARE_ROUTE_COLOR, SHARE_THEMES, buildShareModel, renderShareCard } from "./shareCard.js";
import { loopRoute } from "./testRoutes.js";

const RAW = loopRoute(500);
const activity = {
  id: "a1", name: "Boucle", date: "2026-09-20T08:00:00Z", sportType: "gravel",
  distance: 63.4, movingTime: 8700, duration: 9800, avgSpeed: 26.2, elevationGain: 812,
  gpsTrack: RAW, samples: RAW.map((p, i) => ({ latitude: p.lat, longitude: p.lon, altitude: 200 + 80 * Math.sin(i / 40) })),
  flags: { hasElevation: true },
};

describe("tracé exporté — rose de marque", () => {
  it("la constante vaut #D6116B et alimente les trois thèmes", () => {
    expect(SHARE_ROUTE_COLOR).toBe("#D6116B");
    for (const name of ["dark", "light", "transparent"]) {
      expect(SHARE_THEMES[name].route).toBe("#D6116B");
      expect(SHARE_THEMES[name].startFill).toBe("#D6116B");
    }
  });

  for (const theme of ["dark", "light", "transparent"]) {
    it(`PNG réel (${theme}) : des pixels opaques #D6116B sont bien dessinés, plus de turquoise de tracé`, async () => {
      const model = buildShareModel(activity, { format: "story", theme, simplify: true, hidePlaces: false });
      const canvas = createCanvas(model.width, model.height);
      expect(renderShareCard(canvas, model)).toBe(true);
      const img = await loadImage(canvas.toBuffer("image/png"));
      const back = createCanvas(img.width, img.height);
      const ctx = back.getContext("2d");
      ctx.drawImage(img, 0, 0);
      const { data } = ctx.getImageData(0, 0, img.width, img.height);
      let pink = 0, teal = 0;
      for (let i = 0; i < data.length; i += 4) {
        if (data[i + 3] !== 255) continue;
        const [r, g, b] = [data[i], data[i + 1], data[i + 2]];
        if (r === 0xd6 && g === 0x11 && b === 0x6b) pink++;
        if (Math.abs(r - 52) < 6 && Math.abs(g - 220) < 6 && Math.abs(b - 189) < 6) teal++;
        if (Math.abs(r - 6) < 6 && Math.abs(g - 117) < 6 && Math.abs(b - 99) < 6) teal++;
      }
      expect(pink).toBeGreaterThan(5000); // trait de 10 px sur plusieurs centaines de px
      expect(teal).toBe(0);
    });
  }
});

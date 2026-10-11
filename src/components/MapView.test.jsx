import { describe, it, expect, afterEach, vi, beforeEach } from "vitest";
import { render, cleanup, screen, act } from "@testing-library/react";

// Leaflet ne rend pas dans jsdom : faux module qui capture les options de la carte et expose les événements de tuiles.
const h = vi.hoisted(() => ({ mapOptions: null, tileHandlers: {}, mobile: false }));
vi.mock("leaflet", () => {
  const chain = () => { const o = { addTo: () => o, on: () => o, bindPopup: () => o, remove: () => {}, setLatLng: () => o }; return o; };
  const L = {
    Browser: { get mobile() { return h.mobile; } },
    map: (_el, options) => {
      h.mapOptions = options;
      return { setView: () => {}, invalidateSize: () => {}, fitBounds: () => {}, flyToBounds: () => {}, remove: () => {} };
    },
    tileLayer: () => {
      const layer = { addTo: () => layer, on: (evt, fn) => { h.tileHandlers[evt] = fn; return layer; } };
      return layer;
    },
    layerGroup: () => ({ addTo: () => ({ remove: () => {} }), remove: () => {} }),
    polyline: chain, circleMarker: chain,
    latLngBounds: () => ({}),
  };
  return { default: L };
});
vi.mock("leaflet/dist/leaflet.css", () => ({}));

import { MapView } from "./MapView.jsx";

const analysis = { hasTime: false, hasEle: false, hasHR: false, climbs: [], series: [], minEle: null, maxEle: null };
const decimated = [{ lat: 45, lon: 5, distance: 0 }, { lat: 45.01, lon: 5, distance: 1 }];
const props = { analysis, decimated, colorMode: "track", setColorMode: () => {}, selectedClimb: null };

beforeEach(() => { h.mapOptions = null; h.tileHandlers = {}; h.mobile = false; });
afterEach(cleanup);

describe("MapView — interaction tactile", () => {
  it("garde le déplacement à un doigt par défaut", () => {
    h.mobile = true;
    render(<MapView {...props} />);
    expect(h.mapOptions.dragging).toBe(true);
  });

  it("avec lockTouchPan, laisse la page défiler sur écran tactile mais garde le glisser à la souris", () => {
    h.mobile = true;
    render(<MapView {...props} lockTouchPan />);
    expect(h.mapOptions.dragging).toBe(false);
    cleanup();
    h.mobile = false;
    render(<MapView {...props} lockTouchPan />);
    expect(h.mapOptions.dragging).toBe(true);
  });

  it("transmet scrollWheelZoom", () => {
    render(<MapView {...props} scrollWheelZoom={false} />);
    expect(h.mapOptions.scrollWheelZoom).toBe(false);
  });
});

describe("MapView — erreurs de tuiles", () => {
  it("signale un fond de carte indisponible après 3 échecs sans aucune tuile chargée", () => {
    render(<MapView {...props} />);
    expect(screen.queryByRole("status")).toBeNull();
    act(() => { h.tileHandlers.tileerror(); h.tileHandlers.tileerror(); });
    expect(screen.queryByRole("status")).toBeNull();
    act(() => h.tileHandlers.tileerror());
    expect(screen.getByRole("status").textContent).toMatch(/Fond de carte indisponible/);
  });

  it("ne signale rien si des tuiles se sont déjà chargées, et retire l'alerte quand une tuile se charge", () => {
    render(<MapView {...props} />);
    act(() => h.tileHandlers.tileload());
    act(() => { for (let i = 0; i < 5; i++) h.tileHandlers.tileerror(); });
    expect(screen.queryByRole("status")).toBeNull();

    cleanup();
    h.tileHandlers = {};
    render(<MapView {...props} />);
    act(() => { for (let i = 0; i < 3; i++) h.tileHandlers.tileerror(); });
    expect(screen.getByRole("status")).toBeTruthy();
    act(() => h.tileHandlers.tileload());
    expect(screen.queryByRole("status")).toBeNull();
  });
});

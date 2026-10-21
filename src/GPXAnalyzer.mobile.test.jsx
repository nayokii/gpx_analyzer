/**
 * Import depuis un navigateur SANS File System Access API (téléphone) : jsdom
 * n'a pas `showDirectoryPicker`, donc l'application bascule sur le stockage
 * IndexedDB de l'appareil. Cloud = backend Supabase SIMULÉ.
 */
import "fake-indexeddb/auto";
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, cleanup, screen, fireEvent, waitFor } from "@testing-library/react";
import GPXAnalyzer from "./GPXAnalyzer.jsx";
import { stubResizeObserver } from "./components/testResizeObserverMock.js";
import { __setSupabaseClientForTests } from "./lib/cloud/client.js";
import { __resetSyncCoordinatorForTests } from "./lib/storage/activityRepository.js";
import { createFakeSupabaseBackend } from "./lib/cloud/tests/fakeSupabase.js";
import { clearQueue } from "./lib/storage/syncQueue.js";
import { getBrowserStoreRoot } from "./lib/storage/browserStore.js";
import { listActivities } from "./lib/storage/activityStore.js";

stubResizeObserver();
vi.mock("./components/MapView.jsx", () => ({ MapView: () => null }));

const GPX = `<?xml version="1.0"?><gpx><trk><name>sortie mobile</name><trkseg>
<trkpt lat="45.01" lon="5.01"><ele>200</ele><time>2026-09-21T08:00:00Z</time></trkpt>
<trkpt lat="45.02" lon="5.02"><ele>230</ele><time>2026-09-21T08:30:00Z</time></trkpt>
<trkpt lat="45.03" lon="5.03"><ele>250</ele><time>2026-09-21T09:00:00Z</time></trkpt>
</trkseg></trk></gpx>`;

afterEach(async () => {
  cleanup();
  await new Promise((r) => setTimeout(r, 0));
  __setSupabaseClientForTests(null);
  __resetSyncCoordinatorForTests();
  clearQueue();
});

async function importGpx(container) {
  await screen.findByText(/Glissez-déposez votre fichier/);
  const input = container.querySelector('input[type="file"]');
  const file = new File([GPX], "sortie.gpx", { type: "application/gpx+xml" });
  // jsdom 24 n'implémente pas Blob#text/arrayBuffer : même contenu, exposé à la main.
  file.text = async () => GPX;
  file.arrayBuffer = async () => new TextEncoder().encode(GPX).buffer;
  fireEvent.change(input, { target: { files: [file] } });
}

vi.setConfig({ testTimeout: 30000 });

describe("import mobile (IndexedDB + cloud simulé)", () => {
  it("enregistre sur l'appareil et n'affiche « synchronisée » qu'une fois le cloud confirmé", async () => {
    const backend = createFakeSupabaseBackend();
    __setSupabaseClientForTests(backend.client);
    await backend.signUpAndLogin("m@example.com");

    const { container } = render(<GPXAnalyzer />);
    await importGpx(container);

    await waitFor(() => expect(screen.getByText(/Sortie synchronisée dans le cloud/)).toBeTruthy(), { timeout: 5000 });
    expect(backend._debug.activitiesTable).toHaveLength(1);
    expect(await listActivities(getBrowserStoreRoot())).toHaveLength(1);
  });

  it("réseau coupé : message honnête « PAS encore dans le cloud », puis « Réessayer » réussit", async () => {
    const backend = createFakeSupabaseBackend();
    __setSupabaseClientForTests(backend.client);
    await backend.signUpAndLogin("m2@example.com");
    backend.setNetworkDown(true);

    const { container } = render(<GPXAnalyzer />);
    await importGpx(container);

    await waitFor(() => expect(screen.getByText(/PAS encore dans le cloud/)).toBeTruthy(), { timeout: 5000 });
    expect(screen.queryByText(/Sortie synchronisée dans le cloud/)).toBeNull();
    expect(backend._debug.activitiesTable).toHaveLength(0);

    backend.setNetworkDown(false);
    fireEvent.click(screen.getByRole("button", { name: "Réessayer" }));
    await waitFor(() => expect(screen.getByText(/Sortie synchronisée dans le cloud/)).toBeTruthy(), { timeout: 5000 });
    expect(backend._debug.activitiesTable).toHaveLength(1);
  });

  it("sans compte : copie sur l'appareil uniquement, annoncée comme telle", async () => {
    const backend = createFakeSupabaseBackend();
    __setSupabaseClientForTests(backend.client);

    const { container } = render(<GPXAnalyzer />);
    await importGpx(container);

    await waitFor(() => expect(screen.getByText(/enregistrée sur cet appareil uniquement/)).toBeTruthy(), { timeout: 5000 });
    expect(backend._debug.activitiesTable).toHaveLength(0);
  });
});

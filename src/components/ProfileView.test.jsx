import { describe, it, expect, afterEach, vi } from "vitest";
import { render, cleanup, screen, waitFor, fireEvent, within } from "@testing-library/react";
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
import { ProfileView } from "./ProfileView.jsx";
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

function makeActivity(overrides = {}) {
  const a = createEmptyActivity();
  return {
    ...a,
    id: overrides.id || "a1",
    name: "Sortie test",
    date: "2026-09-20T08:00:00.000Z",
    distance: 30,
    duration: 5400,
    movingTime: 5000,
    elevationGain: 300,
    elevationLoss: 280,
    avgSpeed: 21.6,
    maxSpeed: 45,
    avgPower: null,
    maxPower: null,
    avgHeartRate: null,
    maxHeartRate: null,
    avgCadence: null,
    maxCadence: null,
    flags: { ...a.flags, hasGps: true, hasHeartRate: false, hasCadence: false, hasPower: false, powerEstimated: false },
    samples: [],
    gpsTrack: [],
    ...overrides,
  };
}

async function seed(root, activities) {
  for (const a of activities) {
    await saveActivity(root, a, "<gpx/>", "gpx");
  }
}

function connectedStorage(root) {
  return { status: "connected", rootHandle: root, dirName: "test" };
}

const noop = () => {};

afterEach(cleanup);

// Le nom d'une dimension apparaît aussi comme option du sélecteur de la
// timeline (voir EvolutionSection) : on cible précisément la carte, pas le
// premier élément portant ce texte.
function getDimensionCard(name) {
  const matches = screen.getAllByText(name);
  const head = matches.find((el) => el.closest(".gpx-profile-card"));
  if (!head) throw new Error(`Carte de dimension "${name}" introuvable.`);
  return head.closest(".gpx-profile-card");
}

describe("ProfileView — stockage non connecté", () => {
  it("invite à connecter un dossier, sans tenter de calculer un profil", () => {
    render(<ProfileView storage={{ status: "disconnected", rootHandle: null }} onConnect={noop} onReconnect={noop} onBack={noop} />);
    expect(screen.getByText(/Connecte un dossier local/)).toBeTruthy();
    expect(screen.queryByText(/Analyse basée sur/)).toBeNull();
  });
});

describe("ProfileView — 0 activité", () => {
  it("affiche l'état vide explicite, jamais un profil vide déguisé en résultat", async () => {
    const root = new MemoryDirectoryHandle();
    render(<ProfileView storage={connectedStorage(root)} onConnect={noop} onReconnect={noop} onBack={noop} />);
    await waitFor(() => expect(screen.getByText(/apparaîtra ici après ta première sortie/)).toBeTruthy());
    expect(screen.getByText(/Importe un GPX ou un FIT pour commencer/)).toBeTruthy();
    expect(screen.queryByText("Dimensions")).toBeNull();
  });
});

describe("ProfileView — cold start avec le vrai FIT (1 sortie)", () => {
  it("affiche les valeurs réellement retournées par le moteur, jamais des valeurs codées en dur", async () => {
    const root = new MemoryDirectoryHandle();
    const { activity, arrayBuffer } = await loadRealFitActivity();
    await saveActivity(root, activity, arrayBuffer, "fit");

    // Référence de vérité : le moteur lui-même, pas des constantes choisies à l'avance.
    const expected = computeCyclistProfile([activity]);

    render(<ProfileView storage={connectedStorage(root)} onConnect={noop} onReconnect={noop} onBack={noop} />);

    await waitFor(() => expect(screen.getByText(/Analyse basée sur 1 sortie/)).toBeTruthy());
    expect(screen.getByText(/Profil en construction/)).toBeTruthy();

    const enduranceCard = getDimensionCard("Endurance");
    expect(within(enduranceCard).getByText(String(expected.dimensions.endurance.value))).toBeTruthy();
    expect(within(enduranceCard).getByText("faible")).toBeTruthy();

    const sprintCard = getDimensionCard("Sprint");
    expect(expected.dimensions.sprint.value).toBeNull();
    expect(within(sprintCard).getByText("—")).toBeTruthy();
    expect(within(sprintCard).getByText("Données insuffisantes")).toBeTruthy();

    const technicalCard = getDimensionCard("Technique");
    expect(expected.dimensions.technical.value).toBeNull();
    expect(within(technicalCard).getByText("Données insuffisantes")).toBeTruthy();
  });

  it("n'affiche jamais 0 pour une dimension sans donnée suffisante", async () => {
    const root = new MemoryDirectoryHandle();
    const { activity, arrayBuffer } = await loadRealFitActivity();
    await saveActivity(root, activity, arrayBuffer, "fit");

    render(<ProfileView storage={connectedStorage(root)} onConnect={noop} onReconnect={noop} onBack={noop} />);
    await waitFor(() => expect(screen.getAllByText("Sprint").length).toBeGreaterThan(0));

    const sprintCard = getDimensionCard("Sprint");
    expect(within(sprintCard).queryByText("0")).toBeNull();
  });

  it("l'évolution indique explicitement qu'il n'y a pas assez de données avec 1 seule sortie", async () => {
    const root = new MemoryDirectoryHandle();
    const { activity, arrayBuffer } = await loadRealFitActivity();
    await saveActivity(root, activity, arrayBuffer, "fit");

    render(<ProfileView storage={connectedStorage(root)} onConnect={noop} onReconnect={noop} onBack={noop} />);
    await waitFor(() => expect(screen.getByText("Évolution du profil")).toBeTruthy());
    expect(screen.getByText(/Pas encore assez de données pour établir une évolution fiable/)).toBeTruthy();
  });

  it("affiche la qualité des données agrégée depuis les flags de l'activité", async () => {
    const root = new MemoryDirectoryHandle();
    const { activity, arrayBuffer } = await loadRealFitActivity();
    await saveActivity(root, activity, arrayBuffer, "fit");

    render(<ProfileView storage={connectedStorage(root)} onConnect={noop} onReconnect={noop} onBack={noop} />);
    await waitFor(() => expect(screen.getByText("Qualité des données")).toBeTruthy());

    const hrRow = screen.getByText("Fréquence cardiaque").closest(".gpx-profile-dataquality-row");
    expect(within(hrRow).getByText("—")).toBeTruthy(); // pas de HR sur cette vraie sortie
    const powerRow = screen.getByText("Puissance").closest(".gpx-profile-dataquality-row");
    expect(within(powerRow).getByText("estimée")).toBeTruthy();
  });
});

describe("ProfileView — évidence (pourquoi ce score ?)", () => {
  it("affiche les preuves du moteur au clic, verbatim (pas de texte recréé dans React)", async () => {
    const root = new MemoryDirectoryHandle();
    const { activity, arrayBuffer } = await loadRealFitActivity();
    await saveActivity(root, activity, arrayBuffer, "fit");
    const expected = computeCyclistProfile([activity]);

    render(<ProfileView storage={connectedStorage(root)} onConnect={noop} onReconnect={noop} onBack={noop} />);
    await waitFor(() => expect(screen.getAllByText("Endurance").length).toBeGreaterThan(0));

    const enduranceCard = getDimensionCard("Endurance");
    const toggle = within(enduranceCard).getByText(`Pourquoi ${expected.dimensions.endurance.value} ?`);
    fireEvent.click(toggle);

    for (const evidence of expected.dimensions.endurance.evidence) {
      expect(within(enduranceCard).getByText(evidence.reason)).toBeTruthy();
    }
  });

  it("ouvre l'activité correspondante au clic sur une preuve, quand onOpen est fourni", async () => {
    const root = new MemoryDirectoryHandle();
    const { activity, arrayBuffer } = await loadRealFitActivity();
    await saveActivity(root, activity, arrayBuffer, "fit");
    const onOpen = vi.fn();

    render(<ProfileView storage={connectedStorage(root)} onConnect={noop} onReconnect={noop} onOpen={onOpen} onBack={noop} />);
    await waitFor(() => expect(screen.getAllByText("Endurance").length).toBeGreaterThan(0));

    const enduranceCard = getDimensionCard("Endurance");
    fireEvent.click(within(enduranceCard).getByText(/^Pourquoi/));
    const [firstEvidenceItem] = within(enduranceCard).getAllByRole("listitem");
    fireEvent.click(firstEvidenceItem);
    expect(onOpen).toHaveBeenCalledWith(activity.id);
  });
});

describe("ProfileView — confiance séparée du score", () => {
  it("affiche le score et le libellé de confiance comme deux informations distinctes", async () => {
    const root = new MemoryDirectoryHandle();
    const { activity, arrayBuffer } = await loadRealFitActivity();
    await saveActivity(root, activity, arrayBuffer, "fit");
    const expected = computeCyclistProfile([activity]);

    render(<ProfileView storage={connectedStorage(root)} onConnect={noop} onReconnect={noop} onBack={noop} />);
    await waitFor(() => expect(screen.getAllByText("Endurance").length).toBeGreaterThan(0));

    const enduranceCard = getDimensionCard("Endurance");
    expect(within(enduranceCard).getByText(String(expected.dimensions.endurance.value))).toBeTruthy();
    expect(within(enduranceCard).getByText("faible")).toBeTruthy();
    // Le texte de confiance n'est jamais une transformation arbitraire : il vient du label du moteur.
    expect(expected.dimensions.endurance.confidenceLabel).toBe("low");
  });
});

describe("ProfileView — données mesurées (HR, cadence, puissance mesurée)", () => {
  it("distingue une sortie complètement instrumentée dans la qualité des données", async () => {
    const root = new MemoryDirectoryHandle();
    const activities = Array.from({ length: 3 }, (_, i) =>
      makeActivity({
        id: `full-${i}`,
        date: `2026-0${i + 1}-05T08:00:00Z`,
        avgHeartRate: 145,
        maxHeartRate: 172,
        avgCadence: 82,
        maxCadence: 98,
        avgPower: 190,
        maxPower: 410,
        flags: { hasGps: true, hasElevation: true, hasTime: true, hasHeartRate: true, hasCadence: true, hasPower: true, powerEstimated: false },
      })
    );
    await seed(root, activities);

    render(<ProfileView storage={connectedStorage(root)} onConnect={noop} onReconnect={noop} onBack={noop} />);
    await waitFor(() => expect(screen.getByText("Qualité des données")).toBeTruthy());

    const hrRow = screen.getByText("Fréquence cardiaque").closest(".gpx-profile-dataquality-row");
    expect(within(hrRow).getByText("✓")).toBeTruthy();
    const cadenceRow = screen.getByText("Cadence").closest(".gpx-profile-dataquality-row");
    expect(within(cadenceRow).getByText("✓")).toBeTruthy();
    const powerRow = screen.getByText("Puissance").closest(".gpx-profile-dataquality-row");
    expect(within(powerRow).getByText("mesurée")).toBeTruthy();
  });
});

describe("ProfileView — timeline avec plusieurs points", () => {
  it("affiche un graphique d'évolution avec plusieurs mois de sorties", async () => {
    const root = new MemoryDirectoryHandle();
    const activities = [
      makeActivity({ id: "m1", date: "2026-04-05T08:00:00Z", movingTime: 3600 }),
      makeActivity({ id: "m2", date: "2026-05-05T08:00:00Z", movingTime: 5400 }),
      makeActivity({ id: "m3", date: "2026-06-05T08:00:00Z", movingTime: 7200 }),
    ];
    await seed(root, activities);

    render(<ProfileView storage={connectedStorage(root)} onConnect={noop} onReconnect={noop} onBack={noop} />);
    await waitFor(() => expect(screen.getByText("Évolution du profil")).toBeTruthy());
    expect(screen.queryByText(/Pas encore assez de données pour établir une évolution fiable/)).toBeNull();
  });

  it("permet de changer la dimension affichée dans l'évolution", async () => {
    const root = new MemoryDirectoryHandle();
    const activities = [
      makeActivity({ id: "m1", date: "2026-04-05T08:00:00Z" }),
      makeActivity({ id: "m2", date: "2026-05-05T08:00:00Z" }),
    ];
    await seed(root, activities);

    render(<ProfileView storage={connectedStorage(root)} onConnect={noop} onReconnect={noop} onBack={noop} />);
    const select = await screen.findByLabelText("Dimension affichée dans l'évolution");
    fireEvent.change(select, { target: { value: "climbing" } });
    expect(select.value).toBe("climbing");
  });
});

describe("ProfileView — Phase 9F, \"ce que tes sorties documentent\" / \"ce qui manque encore\"", () => {
  it("avec le vrai FIT (1 sortie) : liste les dimensions dispo sous 'documentent', les insuffisantes sous 'manque encore', jamais les deux à la fois", async () => {
    const root = new MemoryDirectoryHandle();
    const { activity, arrayBuffer } = await loadRealFitActivity();
    await saveActivity(root, activity, arrayBuffer, "fit");
    const expected = computeCyclistProfile([activity]);

    render(<ProfileView storage={connectedStorage(root)} onConnect={noop} onReconnect={noop} onBack={noop} />);
    await waitFor(() => expect(screen.getByText("Ce que tes sorties commencent à documenter")).toBeTruthy());

    const documented = screen.getByText("Ce que tes sorties commencent à documenter").closest(".gpx-panel").textContent;
    const missing = screen.getByText("Ce qui manque encore").closest(".gpx-panel").textContent;

    expect(expected.dimensions.endurance.value).not.toBeNull();
    expect(documented).toMatch(/Endurance/);
    expect(expected.dimensions.sprint.value).toBeNull();
    expect(missing).toMatch(/Sprint/);
    // Jamais la même dimension listée des deux côtés.
    expect(documented).not.toMatch(/Sprint/);
    expect(missing).not.toMatch(/Endurance/);
  });

  it("un jeu de 6 activités réelles (fixture FIT dupliquée sur plusieurs dates, sans capteur HR/cadence/puissance réelle) : les compteurs affichés viennent du moteur, jamais inventés", async () => {
    const root = new MemoryDirectoryHandle();
    const { activity } = await loadRealFitActivity();
    // 6 activités "réelles" (mêmes échantillons, dates différentes) pour
    // simuler le volume du dossier réel de l'utilisateur (1 FIT + 5 GPX,
    // caractéristiques identiques : pas de HR/cadence, puissance estimée,
    // pas de mtb/gravel) sans dépendre d'un chemin de fichier personnel.
    const activities = Array.from({ length: 6 }, (_, i) => ({
      ...activity,
      id: `real-like-${i}`,
      date: `2026-0${(i % 2) + 8}-${String(10 + i).padStart(2, "0")}T08:00:00Z`,
    }));
    await seed(root, activities);
    const expected = computeCyclistProfile(activities);
    expect(expected.activityCount).toBe(6);

    render(<ProfileView storage={connectedStorage(root)} onConnect={noop} onReconnect={noop} onBack={noop} />);
    await waitFor(() => expect(screen.getByText(/Analyse basée sur 6 sorties/)).toBeTruthy());

    const enduranceCard = getDimensionCard("Endurance");
    expect(within(enduranceCard).getByText(new RegExp(`${expected.dimensions.endurance.contributingActivities} sorties? exploitable`))).toBeTruthy();

    // Sprint (puissance mesurée requise) et Technique (mtb/gravel requis) :
    // structurellement insuffisants ici aussi, quel que soit le volume.
    expect(expected.dimensions.sprint.value).toBeNull();
    expect(expected.dimensions.technical.value).toBeNull();
    const missing = screen.getByText("Ce qui manque encore").closest(".gpx-panel").textContent;
    expect(missing).toMatch(/Sprint/);
    expect(missing).toMatch(/Technique/);
  });
});

describe("ProfileView — Phase 9F, évolution par dimension (tendance)", () => {
  it("une seule sortie : 'Premières observations', jamais une flèche de tendance inventée", async () => {
    const root = new MemoryDirectoryHandle();
    const { activity, arrayBuffer } = await loadRealFitActivity();
    await saveActivity(root, activity, arrayBuffer, "fit");

    render(<ProfileView storage={connectedStorage(root)} onConnect={noop} onReconnect={noop} onBack={noop} />);
    await waitFor(() => expect(screen.getAllByText("Endurance").length).toBeGreaterThan(0));

    const enduranceCard = getDimensionCard("Endurance");
    expect(within(enduranceCard).getByText("Premières observations")).toBeTruthy();
    expect(within(enduranceCard).queryByText(/évolution récente/)).toBeNull();
  });

  it("plusieurs mois de sorties : affiche une direction qualitative (↗/↘/stable), jamais un pourcentage", async () => {
    const root = new MemoryDirectoryHandle();
    const activities = [
      makeActivity({ id: "m1", date: "2026-04-05T08:00:00Z", movingTime: 3600 }),
      makeActivity({ id: "m2", date: "2026-05-05T08:00:00Z", movingTime: 5400 }),
      makeActivity({ id: "m3", date: "2026-06-05T08:00:00Z", movingTime: 7200 }),
    ];
    await seed(root, activities);

    render(<ProfileView storage={connectedStorage(root)} onConnect={noop} onReconnect={noop} onBack={noop} />);
    await waitFor(() => expect(screen.getAllByText("Endurance").length).toBeGreaterThan(0));

    const enduranceCard = getDimensionCard("Endurance");
    const cardText = enduranceCard.textContent;
    expect(cardText).not.toMatch(/%/);
    expect(cardText).toMatch(/évolution récente|stable sur la période observée|Premières observations/);
  });
});

describe("ProfileView — erreur de chargement partielle", () => {
  it("reste utilisable et calcule le profil à partir des sorties disponibles si une activité échoue", async () => {
    const root = new MemoryDirectoryHandle();
    const activities = [
      makeActivity({ id: "ok-1", date: "2026-04-05T08:00:00Z" }),
      makeActivity({ id: "ok-2", date: "2026-05-05T08:00:00Z" }),
    ];
    await seed(root, activities);

    // Simule un fichier .json corrompu/illisible pour une seule activité :
    // loadActivityDetail doit échouer pour "ok-1" sans faire planter tout le profil.
    const activitiesDir = await root.getDirectoryHandle("activities");
    const realGetFileHandle = activitiesDir.getFileHandle.bind(activitiesDir);
    activitiesDir.getFileHandle = async (name, opts) => {
      if (name.includes("ok-1") && name.endsWith(".json")) throw new Error("fichier corrompu simulé");
      return realGetFileHandle(name, opts);
    };

    render(<ProfileView storage={connectedStorage(root)} onConnect={noop} onReconnect={noop} onBack={noop} />);
    await waitFor(() => expect(screen.getByText(/n'a pas pu être chargée/)).toBeTruthy());
    // Le profil reste calculé et affiché malgré l'échec partiel.
    await waitFor(() => expect(screen.getByText(/Analyse basée sur 1 sortie/)).toBeTruthy());
    expect(screen.getByText("Dimensions")).toBeTruthy();
  });
});

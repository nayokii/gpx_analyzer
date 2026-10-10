/**
 * Non-régression : l'analyse du terrain est ISOLÉE. Aucun calcul de score existant (profil, archétypes, simulateur,
 * Alter Ego, coach, progression, analyses) ni aucune vue d'historique, de feed, de stockage ou d'authentification
 * n'importe `lib/terrain` ou `TerrainView` : le terrain ne peut donc pas modifier ces scores.
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SRC = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const IMPORT_RE = /(?:from|import)\s*\(?\s*["']([^"']+)["']/g;

function walk(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else if (/\.(jsx?|mjs)$/.test(entry.name)) out.push(full);
  }
  return out;
}
const rel = (f) => path.relative(SRC, f).split(path.sep).join("/");
const importsOf = (file) => [...fs.readFileSync(file, "utf8").matchAll(IMPORT_RE)].map((m) => m[1]);
const touchesTerrain = (spec) => /(^|\/)terrain(\/|$)/.test(spec) || /TerrainView/.test(spec) || /terrain\.css$/.test(spec);

// Seuls ces fichiers ont le droit de référencer le terrain.
const ALLOWED = (f) => f.startsWith("lib/terrain/") || f.startsWith("components/TerrainView") || f === "GPXAnalyzer.jsx" || f === "main.jsx";

describe("isolation de lib/terrain", () => {
  const all = walk(SRC).map((f) => ({ file: rel(f), abs: f }));

  it("le scan couvre bien les modules à protéger", () => {
    for (const dir of ["lib/profile/", "lib/archetypes/", "lib/simulator/", "lib/coach/", "lib/progression/", "lib/history/", "lib/storage/", "lib/cloud/"]) {
      expect(all.some((f) => f.file.startsWith(dir)), dir).toBe(true);
    }
    for (const f of ["components/ProfileView.jsx", "components/AlterEgoView.jsx", "components/ArchetypeView.jsx", "components/TourView.jsx", "components/HistoryDashboard.jsx", "components/ActivityFeedView.jsx", "components/CloudAccountPanel.jsx"]) {
      expect(all.some((x) => x.file === f), f).toBe(true);
    }
  });

  it("aucun fichier de profil, d'archétypes, de simulateur (ni d'ailleurs de coach, historique, feed, stockage, cloud) n'importe lib/terrain", () => {
    const offenders = all
      .filter(({ file }) => !ALLOWED(file))
      .filter(({ abs }) => importsOf(abs).some(touchesTerrain))
      .map(({ file }) => file);
    expect(offenders).toEqual([]);
  });

  it("seuls GPXAnalyzer.jsx et main.jsx (câblage de l'onglet) importent le terrain depuis l'extérieur du module", () => {
    const internal = (f) => f.startsWith("lib/terrain/") || f.startsWith("components/TerrainView");
    const users = all.filter(({ file }) => !internal(file)).filter(({ abs }) => importsOf(abs).some(touchesTerrain)).map((f) => f.file).sort();
    expect(users).toEqual(["GPXAnalyzer.jsx", "main.jsx"]);
  });

  it("lib/terrain n'importe aucun module de score (profil, archétypes, simulateur, progression, coach) : dépendance à sens unique", () => {
    const forbidden = /(^|\/)(profile|archetypes|simulator|progression|coach|history|storage|cloud)(\/|$)/;
    const offenders = all
      .filter(({ file }) => file.startsWith("lib/terrain/") && !file.endsWith(".test.js"))
      .flatMap(({ file, abs }) => importsOf(abs).filter((s) => s.startsWith(".") && forbidden.test(s)).map((s) => `${file} → ${s}`));
    expect(offenders).toEqual([]);
  });
});

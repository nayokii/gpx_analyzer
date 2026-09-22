import { describe, it, expect } from "vitest";
import { REFERENCE_RIDERS, getRiderById } from "./references.js";
import { ARCHETYPE_DIMENSIONS } from "./archetypes.js";

describe("REFERENCE_RIDERS — intégrité des données", () => {
  it("contient entre 12 et 20 profils (voir consigne §5)", () => {
    expect(REFERENCE_RIDERS.length).toBeGreaterThanOrEqual(12);
    expect(REFERENCE_RIDERS.length).toBeLessThanOrEqual(20);
  });

  it("chaque id est unique", () => {
    const ids = REFERENCE_RIDERS.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("chaque coureur a un nom, une discipline et une description", () => {
    for (const r of REFERENCE_RIDERS) {
      expect(typeof r.name).toBe("string");
      expect(r.name.length).toBeGreaterThan(0);
      expect(typeof r.discipline).toBe("string");
      expect(typeof r.description).toBe("string");
      expect(r.description.length).toBeGreaterThan(0);
    }
  });

  it("chaque coureur a au moins une spécialité déclarée", () => {
    for (const r of REFERENCE_RIDERS) {
      expect(Array.isArray(r.specialties)).toBe(true);
      expect(r.specialties.length).toBeGreaterThan(0);
    }
  });

  it("le profil de chaque coureur ne contient QUE les 6 dimensions de style, jamais consistency ni de clé étrangère", () => {
    for (const r of REFERENCE_RIDERS) {
      expect(Object.keys(r.profile).sort()).toEqual([...ARCHETYPE_DIMENSIONS].sort());
    }
  });

  it("aucune valeur de dimension hors de l'échelle 0-100 (les null sont acceptés)", () => {
    for (const r of REFERENCE_RIDERS) {
      for (const dim of ARCHETYPE_DIMENSIONS) {
        const v = r.profile[dim];
        if (v == null) continue;
        expect(typeof v).toBe("number");
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(100);
      }
    }
  });

  it("chaque coureur a au moins une dimension renseignée (jamais un profil entièrement null)", () => {
    for (const r of REFERENCE_RIDERS) {
      const known = ARCHETYPE_DIMENSIONS.filter((d) => r.profile[d] != null);
      expect(known.length).toBeGreaterThan(0);
    }
  });

  it("chaque coureur a au moins une source, avec un label et une URL http(s)", () => {
    for (const r of REFERENCE_RIDERS) {
      expect(Array.isArray(r.sources)).toBe(true);
      expect(r.sources.length).toBeGreaterThan(0);
      for (const s of r.sources) {
        expect(typeof s.label).toBe("string");
        expect(s.label.length).toBeGreaterThan(0);
        expect(s.url).toMatch(/^https:\/\//);
      }
    }
  });

  it("couvre au moins un profil par grande famille de style (climbing, punch, sprint, time_trial, technical)", () => {
    const allSpecialties = new Set(REFERENCE_RIDERS.flatMap((r) => r.specialties));
    for (const expected of ["climbing", "punch", "sprint", "time_trial", "technical"]) {
      expect(allSpecialties.has(expected)).toBe(true);
    }
  });
});

describe("getRiderById", () => {
  it("retrouve un coureur par id", () => {
    expect(getRiderById("nairo-quintana").name).toBe("Nairo Quintana");
  });

  it("retourne null pour un id inconnu", () => {
    expect(getRiderById("does-not-exist")).toBeNull();
  });
});

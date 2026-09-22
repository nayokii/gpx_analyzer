import { describe, it, expect } from "vitest";
import { computeConsistency } from "./consistency.js";

function activityOn(id, isoDate, distance = 40) {
  return { id, date: isoDate, distance };
}

describe("computeConsistency", () => {
  it("liste vide : insufficient_data", () => {
    expect(computeConsistency([]).value).toBeNull();
  });

  it("une seule sortie : insufficient_data (la régularité exige une répétition)", () => {
    const result = computeConsistency([activityOn("a", "2026-06-01T10:00:00Z")]);
    expect(result.value).toBeNull();
    expect(result.confidenceLabel).toBe("insufficient_data");
  });

  it("activités sans date exploitable : insufficient_data", () => {
    const result = computeConsistency([{ id: "a", date: null }, { id: "b", date: null }]);
    expect(result.value).toBeNull();
  });

  it("sorties chaque semaine sur plusieurs semaines : ratio élevé", () => {
    const activities = [];
    for (let w = 0; w < 8; w++) {
      const d = new Date(Date.UTC(2026, 0, 5 + w * 7, 10, 0, 0)); // un lundi chaque semaine
      activities.push(activityOn(`a${w}`, d.toISOString(), 40));
    }
    const result = computeConsistency(activities);
    expect(result.value).toBeGreaterThan(70);
    expect(result.signals.weeksWithActivity).toBe(8);
  });

  it("sorties groupées puis longue interruption : ratio plus bas qu'une pratique étalée régulièrement", () => {
    const clustered = [
      activityOn("a", "2026-01-05T10:00:00Z"),
      activityOn("b", "2026-01-06T10:00:00Z"),
      activityOn("c", "2026-01-07T10:00:00Z"),
      activityOn("d", "2026-06-01T10:00:00Z"), // grosse interruption puis reprise
    ];
    const spread = [];
    for (let w = 0; w < 4; w++) {
      const d = new Date(Date.UTC(2026, 0, 5 + w * 7, 10, 0, 0));
      spread.push(activityOn(`s${w}`, d.toISOString()));
    }
    const clusteredResult = computeConsistency(clustered);
    const spreadResult = computeConsistency(spread);
    expect(spreadResult.value).toBeGreaterThan(clusteredResult.value);
  });

  it("ne qualifie jamais la régularité de trait de caractère (pas de 'discipline'/'motivation' dans la sortie)", () => {
    const activities = [activityOn("a", "2026-01-05T10:00:00Z"), activityOn("b", "2026-01-12T10:00:00Z")];
    const result = computeConsistency(activities);
    const serialized = JSON.stringify(result).toLowerCase();
    expect(serialized).not.toMatch(/discipline|motivation|mental/);
  });

  it("la confiance augmente avec le nombre de semaines actives", () => {
    const few = computeConsistency([activityOn("a", "2026-01-05T10:00:00Z"), activityOn("b", "2026-01-12T10:00:00Z")]);
    const many = (() => {
      const acts = [];
      for (let w = 0; w < 10; w++) {
        const d = new Date(Date.UTC(2026, 0, 5 + w * 7, 10, 0, 0));
        acts.push(activityOn(`a${w}`, d.toISOString()));
      }
      return computeConsistency(acts);
    })();
    expect(many.confidence).toBeGreaterThan(few.confidence);
  });
});

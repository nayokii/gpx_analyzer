import { describe, it, expect } from "vitest";
import { summarizeDimensionTrend } from "./trend.js";

function point(value, contributingActivities = 1) {
  return { profile: { dimensions: { climbing: { value, contributingActivities } } } };
}

describe("summarizeDimensionTrend", () => {
  it("timeline vide : insufficient", () => {
    expect(summarizeDimensionTrend([], "climbing")).toEqual({ status: "insufficient", pointCount: 0, contributingActivities: null });
  });

  it("aucun point daté avec une valeur exploitable pour cette dimension : insufficient", () => {
    const timeline = [point(null), point(null)];
    expect(summarizeDimensionTrend(timeline, "climbing").status).toBe("insufficient");
  });

  it("un seul point avec une valeur : emerging (jamais une tendance sur 1 point)", () => {
    const timeline = [point(43, 4)];
    const result = summarizeDimensionTrend(timeline, "climbing");
    expect(result.status).toBe("emerging");
    expect(result.pointCount).toBe(1);
    expect(result.contributingActivities).toBe(4);
  });

  it("deux points, valeur en hausse : up", () => {
    const timeline = [point(30), point(50)];
    const result = summarizeDimensionTrend(timeline, "climbing");
    expect(result.status).toBe("up");
    expect(result.pointCount).toBe(2);
  });

  it("deux points, valeur en baisse : down", () => {
    const timeline = [point(60), point(40)];
    expect(summarizeDimensionTrend(timeline, "climbing").status).toBe("down");
  });

  it("deux points, valeur identique : stable", () => {
    const timeline = [point(50), point(50)];
    expect(summarizeDimensionTrend(timeline, "climbing").status).toBe("stable");
  });

  it("compare le PREMIER et le DERNIER point datés, ignore les null intermédiaires", () => {
    const timeline = [point(30), point(null), point(70)];
    const result = summarizeDimensionTrend(timeline, "climbing");
    expect(result.status).toBe("up");
    expect(result.pointCount).toBe(2); // seuls les 2 points avec valeur comptent
  });

  it("ne fabrique jamais de pourcentage ni de magnitude — seulement une direction qualitative", () => {
    const timeline = [point(10), point(90)];
    const result = summarizeDimensionTrend(timeline, "climbing");
    expect(Object.keys(result).sort()).toEqual(["contributingActivities", "pointCount", "status"]);
    expect(typeof result.status).toBe("string");
  });

  it("contributingActivities reflète le DERNIER point connu, pas le premier", () => {
    const timeline = [point(30, 2), point(70, 5)];
    expect(summarizeDimensionTrend(timeline, "climbing").contributingActivities).toBe(5);
  });

  it("dimension absente du profil de certains points : traitée comme une valeur manquante, jamais une exception", () => {
    const timeline = [{ profile: { dimensions: {} } }, point(50)];
    expect(() => summarizeDimensionTrend(timeline, "climbing")).not.toThrow();
    expect(summarizeDimensionTrend(timeline, "climbing").status).toBe("emerging");
  });
});

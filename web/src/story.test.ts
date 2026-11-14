import { describe, it, expect } from "vitest";
import { STORY } from "./story";
import { summarizeMunicipalities } from "./stats";

const VIS_KEYS = ["flood", "mask", "sus", "muni"];

describe("story script", () => {
  it("has 6 steps", () => {
    expect(STORY).toHaveLength(6);
  });

  it("every step's layers keys are valid Vis keys", () => {
    for (const s of STORY)
      for (const k of Object.keys(s.layers)) expect(VIS_KEYS).toContain(k);
  });

  it("every step's camera is finite [lng, lat, zoom] with zoom 6..13", () => {
    for (const s of STORY) {
      const [lng, lat, z] = s.camera;
      expect(Number.isFinite(lng)).toBe(true);
      expect(Number.isFinite(lat)).toBe(true);
      expect(Number.isFinite(z)).toBe(true);
      expect(z).toBeGreaterThanOrEqual(6);
      expect(z).toBeLessThanOrEqual(13);
    }
  });

  it("every step has non-empty title and text", () => {
    for (const s of STORY) {
      expect(s.title.length).toBeGreaterThan(0);
      expect(s.text.length).toBeGreaterThan(0);
    }
  });
});

describe("summarizeMunicipalities", () => {
  const feats = [
    { properties: { pop_exposed: 100, risk_category: "critical" } },
    { properties: { pop_exposed: 250, risk_category: "high" } },
    { properties: { pop_exposed: 50, risk_category: "critical" } },
  ];

  it("sums pop_exposed and counts critical municipalities", () => {
    expect(summarizeMunicipalities(feats)).toEqual({ exposed: 400, critical: 2 });
  });

  it("returns zeros for empty or non-array input", () => {
    expect(summarizeMunicipalities([])).toEqual({ exposed: 0, critical: 0 });
    expect(summarizeMunicipalities(null as any)).toEqual({ exposed: 0, critical: 0 });
    expect(summarizeMunicipalities(undefined as any)).toEqual({ exposed: 0, critical: 0 });
  });
});

import { describe, it, expect } from "vitest";
import { STORY } from "./story";
import { summarizeMunicipalities } from "./stats";
import { RISK_LABEL } from "./risk";

const VIS_KEYS = ["flood", "sus", "muni"];

describe("story script", () => {
  it("has 6 steps", () => {
    expect(STORY).toHaveLength(6);
  });

  it("every step's layers is exactly the Vis key set with boolean values", () => {
    for (const s of STORY) {
      expect(Object.keys(s.layers).sort()).toEqual([...VIS_KEYS].sort());
      for (const v of Object.values(s.layers)) expect(typeof v).toBe("boolean");
    }
  });

  it("every step's camera is exactly [lng, lat, zoom] finite with zoom 6..13", () => {
    for (const s of STORY) {
      expect(s.camera).toHaveLength(3);
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

  it("ignores non-finite pop_exposed values", () => {
    const bad = [
      { properties: { pop_exposed: NaN, risk_category: "critical" } },
      { properties: { pop_exposed: Infinity } },
      { properties: { pop_exposed: "12" } },
    ];
    expect(summarizeMunicipalities(bad)).toEqual({ exposed: 0, critical: 1 });
  });

  it("returns zeros for empty or non-array input", () => {
    expect(summarizeMunicipalities([])).toEqual({ exposed: 0, critical: 0 });
    expect(summarizeMunicipalities(null as any)).toEqual({ exposed: 0, critical: 0 });
    expect(summarizeMunicipalities(undefined as any)).toEqual({ exposed: 0, critical: 0 });
  });
});

describe("risk labels", () => {
  it("maps every API category to its English display label", () => {
    expect(RISK_LABEL.critical).toBe("critical");
    expect(RISK_LABEL.high).toBe("high");
    expect(RISK_LABEL.moderate).toBe("moderate");
    expect(RISK_LABEL.low).toBe("low");
  });
});

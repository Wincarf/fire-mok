import { describe, it, expect } from "vitest";
import { countByCategory, summarizeMunicipalities } from "./stats";

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
    expect(summarizeMunicipalities(null)).toEqual({ exposed: 0, critical: 0 });
    expect(summarizeMunicipalities(undefined)).toEqual({ exposed: 0, critical: 0 });
  });
});

describe("countByCategory", () => {
  it("counts each real category, missing -> zero", () => {
    const feats = [
      { properties: { risk_category: "critical" } },
      { properties: { risk_category: "critical" } },
      { properties: { risk_category: "high" } },
      { properties: { risk_category: "low" } },
      { properties: {} },
    ];
    expect(countByCategory(feats)).toEqual({ critical: 2, high: 1, moderate: 0, low: 1 });
  });

  it("tolerates null/undefined/garbage input", () => {
    expect(countByCategory(null)).toEqual({ critical: 0, high: 0, moderate: 0, low: 0 });
    expect(countByCategory(undefined)).toEqual({ critical: 0, high: 0, moderate: 0, low: 0 });
    expect(countByCategory([null, { properties: null }, "x"])).toEqual({
      critical: 0, high: 0, moderate: 0, low: 0,
    });
  });
});

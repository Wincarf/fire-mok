import { describe, it, expect } from "vitest";
import { countByCategory } from "./stats";

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

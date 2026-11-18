import { describe, it, expect } from "vitest";
import { STORY } from "./story";

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

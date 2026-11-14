import { describe, it, expect } from "vitest";
import { riskShapes } from "./risk";

const ORIGIN = { lng: -51.15, lat: -30.05 };

const FC = {
  type: "FeatureCollection",
  features: [
    {
      type: "Feature",
      properties: { code: "430001", name: "Alpha", risk: 0.8 },
      geometry: {
        type: "Polygon",
        coordinates: [
          // ~1km-ish square north-east of origin
          [[-51.14, -30.04], [-51.13, -30.04], [-51.13, -30.03], [-51.14, -30.03], [-51.14, -30.04]],
        ],
      },
    },
    {
      type: "Feature",
      properties: { code: "430002", name: "Beta", risk: 0.1 },
      geometry: {
        type: "MultiPolygon",
        coordinates: [
          // big ring
          [[[-51.2, -30.1], [-51.18, -30.1], [-51.18, -30.08], [-51.2, -30.08], [-51.2, -30.1]]],
          // tiny ring — should be dropped
          [[[-51.0, -30.0], [-51.001, -30.0], [-51.0, -30.001], [-51.0, -30.0]]],
        ],
      },
    },
    {
      type: "Feature",
      properties: { code: "430003", name: "SemRisco" }, // no risk field
      geometry: {
        type: "Polygon",
        coordinates: [[[-51.1, -30.1], [-51.09, -30.1], [-51.09, -30.09], [-51.1, -30.09], [-51.1, -30.1]]],
      },
    },
  ],
};

describe("riskShapes", () => {
  it("projects rings to local meters, keeps name/code/risk", () => {
    const out = riskShapes(FC, ORIGIN);
    expect(out).toHaveLength(3);
    const a = out.find((s) => s.code === "430001")!;
    expect(a.name).toBe("Alpha");
    expect(a.risk).toBe(0.8);
    expect(a.points.length).toBe(5);
    // centered ~1-2km from origin
    const cx = a.points.reduce((s, p) => s + p[0], 0) / a.points.length;
    expect(cx).toBeGreaterThan(500);
  });

  it("MultiPolygon keeps only the largest ring", () => {
    const b = riskShapes(FC, ORIGIN).find((s) => s.code === "430002")!;
    expect(b.points.length).toBe(5); // the big square, not the tiny one
    const xs = b.points.map((p) => p[0]);
    expect(Math.max(...xs) - Math.min(...xs)).toBeGreaterThan(1000); // ~2km wide
  });

  it("missing risk defaults to 0 and unknown geometry is skipped", () => {
    const fc = {
      ...FC,
      features: [...FC.features, { type: "Feature", properties: { code: "x" }, geometry: { type: "Point", coordinates: [0, 0] } }],
    };
    const out = riskShapes(fc, ORIGIN);
    expect(out.find((s) => s.code === "430003")!.risk).toBe(0);
    expect(out.find((s) => s.code === "x")).toBeUndefined();
  });
});

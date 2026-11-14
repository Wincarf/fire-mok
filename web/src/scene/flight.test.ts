import { describe, it, expect } from "vitest";
import { storyFlight } from "./flight";
import { lngLatToXZ } from "./geo";
import type { Step } from "../story";

const ORIGIN = { lng: -51.15, lat: -30.05 };
const STEP = (camera: [number, number, number]): Step => ({
  title: "t",
  text: "x",
  camera,
  layers: { flood: false, mask: false, sus: false, muni: false },
  split: 50,
});

describe("storyFlight", () => {
  it("produces one keyframe per step, looking at the step's ground point", () => {
    const steps = [STEP([-51.2, -30.05, 10]), STEP([-51.15, -30.05, 9])];
    const kfs = storyFlight(steps, ORIGIN);
    expect(kfs).toHaveLength(2);
    const [x, z] = lngLatToXZ(-51.2, -30.05, ORIGIN);
    expect(kfs[0].look[0]).toBeCloseTo(x, 3);
    expect(kfs[0].look[1]).toBe(0);
    expect(kfs[0].look[2]).toBeCloseTo(z, 3);
    expect(kfs[0].ms).toBeGreaterThan(0);
  });

  it("higher zoom => lower camera altitude, always above ground", () => {
    const [low] = storyFlight([STEP([-51.15, -30.05, 9])], ORIGIN);
    const [high] = storyFlight([STEP([-51.15, -30.05, 11])], ORIGIN);
    expect(low.pos[1]).toBeGreaterThan(high.pos[1]);
    expect(high.pos[1]).toBeGreaterThan(500);
  });

  it("camera sits offset from the target (not straight overhead)", () => {
    const [kf] = storyFlight([STEP([-51.15, -30.05, 10])], ORIGIN);
    const [x, z] = lngLatToXZ(-51.15, -30.05, ORIGIN);
    const dx = Math.abs(kf.pos[0] - x);
    const dz = Math.abs(kf.pos[2] - z);
    expect(dx + dz).toBeGreaterThan(kf.pos[1] * 0.3);
  });
});

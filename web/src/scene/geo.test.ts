import { describe, it, expect } from "vitest";
import { lngLatToXZ, decodeHeightmap, buildTerrainArrays } from "./geo";

const ORIGIN = { lng: -51.15, lat: -30.05 };

describe("lngLatToXZ", () => {
  it("origin maps to [0, 0]", () => {
    expect(lngLatToXZ(-51.15, -30.05, ORIGIN)).toEqual([0, 0]);
  });

  it("0.01° east is ~964 m at -30° lat; 0.01° north is ~1105 m", () => {
    const [x] = lngLatToXZ(-51.14, -30.05, ORIGIN);
    expect(x).toBeGreaterThan(950);
    expect(x).toBeLessThan(980);
    const [, z] = lngLatToXZ(-51.15, -30.04, ORIGIN);
    expect(z).toBeGreaterThan(1090);
    expect(z).toBeLessThan(1120);
  });

  it("west and south are negative", () => {
    const [x, z] = lngLatToXZ(-51.16, -30.06, ORIGIN);
    expect(x).toBeLessThan(0);
    expect(z).toBeLessThan(0);
  });
});

describe("decodeHeightmap", () => {
  it("throws when byteLength does not match nx*ny*4", () => {
    const buf = new Float32Array(10).buffer;
    expect(() => decodeHeightmap(buf, 4, 4)).toThrow();
  });

  it("reads little-endian float32 values", () => {
    const src = new Float32Array([1.5, -2.25, 300]);
    const out = decodeHeightmap(src.buffer, 3, 1);
    expect(out[0]).toBeCloseTo(1.5);
    expect(out[1]).toBeCloseTo(-2.25);
    expect(out[2]).toBeCloseTo(300);
  });
});

describe("buildTerrainArrays", () => {
  const nx = 3, ny = 2, cell = 100, exag = 2;
  const elev = new Float32Array([0, 10, 20, 30, 40, 50]);
  const t = buildTerrainArrays(elev, nx, ny, cell, exag);

  it("produces nx*ny vertices with positions/uvs/colors and (nx-1)*(ny-1)*6 indices", () => {
    expect(t.positions).toHaveLength(nx * ny * 3);
    expect(t.uvs).toHaveLength(nx * ny * 2);
    expect(t.colors).toHaveLength(nx * ny * 3);
    expect(t.indices).toHaveLength((nx - 1) * (ny - 1) * 6);
  });

  it("y = elev * exaggeration, mesh centered on origin", () => {
    // vertex 5 = last element: elev 50 * 2 = 100
    expect(t.positions[5 * 3 + 1]).toBe(100);
    // x centered: first vertex x = -(nx-1)*cell/2 = -100
    expect(t.positions[0]).toBe(-100);
    expect(t.positions[5 * 3]).toBe(100);
  });

  it("uv spans 0..1 in both axes", () => {
    const us = [...t.uvs].filter((_, i) => i % 2 === 0);
    const vs = [...t.uvs].filter((_, i) => i % 2 === 1);
    expect(Math.min(...us)).toBe(0);
    expect(Math.max(...us)).toBe(1);
    expect(Math.min(...vs)).toBe(0);
    expect(Math.max(...vs)).toBe(1);
  });

  it("colors are darker at low elevation, lighter at high", () => {
    const lum = (i: number) => t.colors[i * 3] + t.colors[i * 3 + 1] + t.colors[i * 3 + 2];
    expect(lum(5)).toBeGreaterThan(lum(0));
  });
});

import { describe, it, expect, vi, afterEach } from "vitest";
import { fetchBuildings } from "./buildings";

const ORIGIN = { lng: -51.15, lat: -30.05 };
const BBOX: [number, number, number, number] = [-51.3, -30.2, -51.0, -29.9];

const WAY = (id: number, tags: Record<string, string>, coords: [number, number][]) => ({
  type: "way",
  id,
  tags,
  geometry: coords.map(([lon, lat]) => ({ lon, lat })),
});

afterEach(() => vi.unstubAllGlobals());

describe("fetchBuildings", () => {
  it("returns [] when Overpass times out", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        (_u: string, init?: RequestInit) =>
          new Promise((_res, rej) => {
            init?.signal?.addEventListener("abort", () => rej(new DOMException("aborted", "AbortError")));
          })
      )
    );
    const out = await fetchBuildings(BBOX, ORIGIN, 5);
    expect(out).toEqual([]);
  });

  it("returns [] on non-OK response", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("rate limited", { status: 429 })));
    expect(await fetchBuildings(BBOX, ORIGIN, 100)).toEqual([]);
  });

  it("parses footprint center, size and height (height > levels*3 > default 10)", async () => {
    const sq = (lng: number, lat: number) => [
      [lng, lat], [lng + 0.001, lat], [lng + 0.001, lat + 0.001], [lng, lat + 0.001], [lng, lat],
    ] as [number, number][];
    const elements = [
      WAY(1, { building: "yes", height: "21" }, sq(-51.15, -30.05)),
      WAY(2, { building: "yes", "building:levels": "4" }, sq(-51.14, -30.05)),
      WAY(3, { building: "residential" }, sq(-51.16, -30.05)),
    ];
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ elements }), { status: 200 }))
    );
    const out = await fetchBuildings(BBOX, ORIGIN, 100);
    expect(out).toHaveLength(3);
    expect(out[0].h).toBe(21);
    expect(out[1].h).toBe(12);
    expect(out[2].h).toBe(10);
    // footprint ~0.001°: ~96m x ~110m at this latitude
    expect(out[0].w).toBeGreaterThan(80);
    expect(out[0].d).toBeGreaterThan(90);
    // centered near origin (offsets < 2km)
    for (const b of out) {
      expect(Math.abs(b.cx)).toBeLessThan(2000);
      expect(Math.abs(b.cz)).toBeLessThan(2000);
    }
  });

  it("caps the list at 15000 by sampling", async () => {
    const elements = Array.from({ length: 16000 }, (_, i) =>
      WAY(i, { building: "yes" }, [[-51.2, -30.1], [-51.19, -30.1], [-51.19, -30.09], [-51.2, -30.09], [-51.2, -30.1]])
    );
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ elements }), { status: 200 }))
    );
    expect((await fetchBuildings(BBOX, ORIGIN, 100)).length).toBeLessThanOrEqual(15000);
  });
});

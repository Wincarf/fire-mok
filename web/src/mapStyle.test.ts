import { describe, it, expect, beforeAll } from "vitest";
import { selFilter, styleFor } from "./mapStyle";

// styleFor -> withBase reads window.location (vitest runs under node)
beforeAll(() => {
  (globalThis as { window?: unknown }).window = {
    location: { origin: "http://localhost", href: "http://localhost/" },
  };
});

const OFF = { flood: false, sus: false, muni: true };

describe("styleFor", () => {
  it("risk mode has basemap + choropleth, no SAR source", () => {
    const s = styleFor(OFF, "risk");
    expect(Object.keys(s.sources).sort()).toEqual([
      "choreo-calm", "choreo-peak", "choreo-recession",
      "flood", "muni", "osm", "sus",
    ]);
    expect(s.layers.map((l) => l.id)).not.toContain("sar");
  });

  it("before/after modes add the matching SAR tile source above osm", () => {
    const b = styleFor(OFF, "before");
    const tiles = (b.sources.sar as { tiles: string[] }).tiles[0];
    expect(tiles).toContain("/tiles/sar_before/");
    expect(b.layers[1].id).toBe("sar");

    const a = styleFor(OFF, "after");
    expect((a.sources.sar as { tiles: string[] }).tiles[0]).toContain("/tiles/sar_after/");
  });

  it("nisar mode (duet right pane) adds L-band sources without the SAR scene", () => {
    const s = styleFor(OFF, "nisar");
    const ids = s.layers.map((l) => l.id);
    expect(ids).toContain("nisar-hh");
    expect(ids).toContain("nisar-water");
    expect(ids).not.toContain("sar");
    expect(s.sources["nisar-hh" as keyof typeof s.sources]).toBeTruthy();
  });

  it("visibility flags land on the matching raster layers", () => {
    const s = styleFor({ flood: true, sus: false, muni: true }, "risk");
    const flood = s.layers.find((l) => l.id === "flood");
    const sus = s.layers.find((l) => l.id === "sus");
    expect(flood?.layout?.visibility).toBe("visible");
    expect(sus?.layout?.visibility).toBe("none");
  });
});

describe("selFilter", () => {
  it("matches the selected municipality code, sentinel when null", () => {
    expect(selFilter("430001")).toEqual(["==", ["get", "code"], "430001"]);
    expect(selFilter(null)).toEqual(["==", ["get", "code"], "__none__"]);
  });
});

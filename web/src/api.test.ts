import { describe, it, expect, beforeAll, beforeEach, vi } from "vitest";
import {
  fetchMunicipalities,
  fetchPlan,
  floodPolygonsAvailable,
  probeTiler,
  withBase,
} from "./api";

// withBase/getJson read window.location + globalThis.fetch (vitest runs under node)
beforeAll(() => {
  (globalThis as { window?: unknown }).window = {
    location: { origin: "http://localhost", href: "http://localhost/" },
  };
});

const okJson = (body: unknown) =>
  ({ ok: true, json: async () => body }) as Response;

const fetchMock = vi.fn();
beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

describe("withBase", () => {
  it("absolute URL for plain paths", () => {
    expect(withBase("/api/layers")).toBe("http://localhost/api/layers");
  });
  it("manual origin+base join for {z}/{x}/{y} templates", () => {
    expect(withBase("/api/tiles/x/{z}/{x}/{y}.png")).toBe(
      "http://localhost/api/tiles/x/{z}/{x}/{y}.png"
    );
  });
});

describe("fetchers throw on HTTP + malformed; probes swallow to boolean", () => {
  it("fetchMunicipalities returns a valid FeatureCollection", async () => {
    const fc = { type: "FeatureCollection", features: [] };
    fetchMock.mockResolvedValue(okJson(fc));
    await expect(fetchMunicipalities()).resolves.toEqual(fc);
  });

  it("fetchMunicipalities throws on a non-FC payload", async () => {
    fetchMock.mockResolvedValue(okJson({ nope: 1 }));
    await expect(fetchMunicipalities()).rejects.toThrow("unexpected payload shape");
  });

  it("fetchPlan returns a valid plan", async () => {
    const plan = { priority: "critical", reasons: ["r"], actions: ["a"] };
    fetchMock.mockResolvedValue(okJson(plan));
    await expect(fetchPlan("4303508")).resolves.toEqual(plan);
  });

  it("fetchPlan throws on a malformed plan instead of null", async () => {
    fetchMock.mockResolvedValue(okJson({ priority: 42 }));
    await expect(fetchPlan("4303508")).rejects.toThrow("unexpected payload shape");
  });

  it("fetchers throw on non-OK HTTP", async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 500 } as Response);
    await expect(fetchMunicipalities()).rejects.toThrow("HTTP 500");
    await expect(fetchPlan("4303508")).rejects.toThrow("HTTP 500");
  });

  it("probeTiler true on ok, false on network failure", async () => {
    fetchMock.mockResolvedValue(okJson({}));
    await expect(probeTiler()).resolves.toBe(true);
    fetchMock.mockRejectedValue(new Error("down"));
    await expect(probeTiler()).resolves.toBe(false);
  });

  it("floodPolygonsAvailable mirrors HEAD status", async () => {
    fetchMock.mockResolvedValue({ ok: true } as Response);
    await expect(floodPolygonsAvailable()).resolves.toBe(true);
    fetchMock.mockResolvedValue({ ok: false } as Response);
    await expect(floodPolygonsAvailable()).resolves.toBe(false);
    fetchMock.mockRejectedValue(new Error("down"));
    await expect(floodPolygonsAvailable()).resolves.toBe(false);
  });
});

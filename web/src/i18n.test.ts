import { describe, it, expect, vi, afterEach } from "vitest";
import { detectLang, LANDING, STORY_UI } from "./i18n";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("i18n dictionaries", () => {
  it("pt and en expose identical key sets", () => {
    expect(Object.keys(LANDING.pt).sort()).toEqual(Object.keys(LANDING.en).sort());
    expect(Object.keys(STORY_UI.pt).sort()).toEqual(Object.keys(STORY_UI.en).sort());
  });

  it("no empty copy in either language", () => {
    for (const dict of [LANDING, STORY_UI]) {
      for (const lang of ["pt", "en"] as const) {
        for (const v of Object.values(dict[lang])) {
          if (typeof v === "string") expect(v.length).toBeGreaterThan(0);
        }
      }
    }
  });
});

describe("detectLang", () => {
  it("prefers the saved choice over the browser language", () => {
    vi.stubGlobal("localStorage", { getItem: () => "pt" });
    vi.stubGlobal("navigator", { language: "en-US" });
    expect(detectLang()).toBe("pt");
  });

  it("falls back to a pt navigator language", () => {
    vi.stubGlobal("localStorage", { getItem: () => null });
    vi.stubGlobal("navigator", { language: "pt-BR" });
    expect(detectLang()).toBe("pt");
  });

  it("defaults to en for any other language", () => {
    vi.stubGlobal("localStorage", { getItem: () => null });
    vi.stubGlobal("navigator", { language: "fr-FR" });
    expect(detectLang()).toBe("en");
  });

  it("defaults to en when nothing is available", () => {
    vi.stubGlobal("localStorage", undefined);
    vi.stubGlobal("navigator", undefined);
    expect(detectLang()).toBe("en");
  });
});

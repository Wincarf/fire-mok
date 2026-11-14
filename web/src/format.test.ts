import { describe, it, expect } from "vitest";
import { riskScore10, sarSceneDate, fmtInt, fmtPct, SAR_PLATFORM } from "./format";

describe("riskScore10", () => {
  it("formats a 0..1 risk index as a 0..10 score with one decimal", () => {
    expect(riskScore10(0.984)).toBe("9.8");
    expect(riskScore10(0.5)).toBe("5.0");
    expect(riskScore10(0)).toBe("0.0");
  });

  it("clamps out-of-range values to 0..10", () => {
    expect(riskScore10(1.2)).toBe("10.0");
    expect(riskScore10(-0.3)).toBe("0.0");
  });

  it("returns an em dash for non-finite input", () => {
    expect(riskScore10(NaN)).toBe("—");
    expect(riskScore10(Infinity)).toBe("—");
  });
});

describe("sarSceneDate", () => {
  it("parses the acquisition date out of a Sentinel-1 scene filename", () => {
    expect(
      sarSceneDate(
        "S1A_IW_GRDH_1SDV_20240604T084924_20240604T084953_054171_069681_rtc_vv_db.tif"
      )
    ).toBe("04/jun/2024");
    expect(
      sarSceneDate(
        "S1A_IW_GRDH_1SDV_20240511T084943_20240511T085008_053821_068A6E_rtc_vv_db.tif"
      )
    ).toBe("11/mai/2024");
  });

  it("returns an em dash when no timestamp is found", () => {
    expect(sarSceneDate("foo")).toBe("—");
    expect(sarSceneDate("")).toBe("—");
  });
});

describe("SAR_PLATFORM", () => {
  it("names the real platform", () => {
    expect(SAR_PLATFORM).toBe("Sentinel-1A · IW GRD");
  });
});

describe("fmtInt", () => {
  it("formats finite numbers pt-BR", () => {
    expect(fmtInt(39512)).toBe((39512).toLocaleString("pt-BR"));
    expect(fmtInt(0)).toBe("0");
  });
  it("returns an em dash for missing/non-finite input", () => {
    expect(fmtInt(undefined)).toBe("—");
    expect(fmtInt(NaN)).toBe("—");
  });
});

describe("fmtPct", () => {
  it("formats a 0..1 fraction as integer percent", () => {
    expect(fmtPct(0.943)).toBe("94%");
    expect(fmtPct(0)).toBe("0%");
  });
  it("returns an em dash for missing/non-finite input", () => {
    expect(fmtPct(undefined)).toBe("—");
    expect(fmtPct(Infinity)).toBe("—");
  });
});

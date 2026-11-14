// Display helpers for the HUD — all values derived from real data, never mocked.

export const SAR_PLATFORM = "Sentinel-1A · IW GRD";

const MONTHS_EN = [
  "jan", "feb", "mar", "apr", "may", "jun",
  "jul", "aug", "sep", "oct", "nov", "dec",
];

/** Risk index 0..1 → "X.X/10" style score; non-finite → em dash. */
export function riskScore10(risk: number): string {
  if (!Number.isFinite(risk)) return "—";
  return (Math.min(10, Math.max(0, risk * 10))).toFixed(1);
}

/** Acquisition date inside a Sentinel-1 scene filename → "dd/mmm/yyyy". */
export function sarSceneDate(file: string): string {
  const m = file.match(/(\d{4})(\d{2})(\d{2})T\d{6}/);
  if (!m) return "—";
  const [, y, mo, d] = m;
  const month = MONTHS_EN[Number(mo) - 1];
  return month ? `${d}/${month}/${y}` : "—";
}

/** Integer with thousands separators; missing/non-finite → em dash. */
export function fmtInt(v: number | undefined | null): string {
  return typeof v === "number" && Number.isFinite(v) ? v.toLocaleString("en-US") : "—";
}

/** 0..1 fraction → integer percent; missing/non-finite → em dash. */
export function fmtPct(frac: number | undefined | null): string {
  return typeof frac === "number" && Number.isFinite(frac) ? `${Math.round(frac * 100)}%` : "—";
}

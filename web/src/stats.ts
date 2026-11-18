import { isRiskCategory, type RiskCategory } from "./risk";

// Elements arrive as raw GeoJSON from the API — the functions tolerate
// anything (missing properties, wrong types), so the input is typed unknown.
type Munis = readonly unknown[] | null | undefined;

const props = (f: unknown): Record<string, unknown> | null =>
  f && typeof f === "object"
    ? ((f as { properties?: Record<string, unknown> | null }).properties ?? null)
    : null;

export type MuniSummary = { exposed: number; critical: number };

export function summarizeMunicipalities(features: Munis): MuniSummary {
  if (!Array.isArray(features)) return { exposed: 0, critical: 0 };
  let exposed = 0;
  let critical = 0;
  for (const f of features) {
    const p = props(f);
    const e = p?.pop_exposed;
    if (typeof e === "number" && Number.isFinite(e)) exposed += e;
    const c = p?.risk_category;
    if (isRiskCategory(c) && c === "critical") critical += 1;
  }
  return { exposed, critical };
}

export type RiskCounts = Record<RiskCategory, number>;

export function countByCategory(features: Munis): RiskCounts {
  const out: RiskCounts = { critical: 0, high: 0, moderate: 0, low: 0 };
  if (!Array.isArray(features)) return out;
  for (const f of features) {
    const c = props(f)?.risk_category;
    if (isRiskCategory(c)) out[c] += 1;
  }
  return out;
}

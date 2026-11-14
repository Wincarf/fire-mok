export function summarizeMunicipalities(
  features: any[] | null | undefined
): { exposed: number; critical: number } {
  if (!Array.isArray(features)) return { exposed: 0, critical: 0 };
  let exposed = 0;
  let critical = 0;
  for (const f of features) {
    const p = f?.properties ?? {};
    if (Number.isFinite(p.pop_exposed)) exposed += p.pop_exposed;
    if (p.risk_category === "critical") critical += 1;
  }
  return { exposed, critical };
}

export type RiskCounts = { critical: number; high: number; moderate: number; low: number };

export function countByCategory(
  features: any[] | null | undefined
): RiskCounts {
  const out: RiskCounts = { critical: 0, high: 0, moderate: 0, low: 0 };
  if (!Array.isArray(features)) return out;
  for (const f of features) {
    const c = f?.properties?.risk_category;
    if (c === "critical" || c === "high" || c === "moderate" || c === "low")
      out[c as keyof RiskCounts] += 1;
  }
  return out;
}

export function summarizeMunicipalities(
  features: any[] | null | undefined
): { exposed: number; critical: number } {
  if (!Array.isArray(features)) return { exposed: 0, critical: 0 };
  let exposed = 0;
  let critical = 0;
  for (const f of features) {
    const p = f?.properties ?? {};
    if (typeof p.pop_exposed === "number") exposed += p.pop_exposed;
    if (p.risk_category === "critical") critical += 1;
  }
  return { exposed, critical };
}

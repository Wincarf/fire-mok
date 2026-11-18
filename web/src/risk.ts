// The API emits risk categories as English enum strings — this module is the
// single vocabulary every consumer shares (map paint, legend chips, badges).
// Colors were previously declared in 4 places and had already diverged
// (TriagePanel painted "low" green while the map used gray).

export type RiskCategory = "critical" | "high" | "moderate" | "low";

export const RISK_CATEGORIES: readonly RiskCategory[] = [
  "critical",
  "high",
  "moderate",
  "low",
];

// canonical palette — map fill/line + legend chips share these hues
export const RISK_COLOR: Record<RiskCategory, string> = {
  critical: "#ef4444", // red-500
  high: "#f97316", // orange-500 — clearly distinct from yellow
  moderate: "#facc15", // yellow-400
  low: "#94a3b8", // slate-400 — neutral wash, 477 munis shouldn't paint the map
};

// tailwind needs literal class names — one swatch per category, same hues
export const RISK_CHIP: Record<RiskCategory, string> = {
  critical: "bg-[#ef4444]",
  high: "bg-[#f97316]",
  moderate: "bg-[#facc15]",
  low: "bg-[#94a3b8]",
};

// TriagePanel level badge — same palette, tinted container variants
export const RISK_BADGE: Record<RiskCategory, string> = {
  critical: "bg-error-container/40 text-error border-error/50",
  high: "bg-[#f97316]/15 text-[#fdba74] border-[#f97316]/40",
  moderate: "bg-[#facc15]/15 text-[#fde047] border-[#facc15]/40",
  low: "bg-[#94a3b8]/15 text-[#cbd5e1] border-[#94a3b8]/40",
};

export const isRiskCategory = (v: unknown): v is RiskCategory =>
  typeof v === "string" && (RISK_CATEGORIES as readonly string[]).includes(v);

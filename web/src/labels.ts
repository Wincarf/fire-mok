// API risk categories are English enum values; the UI speaks plain Portuguese.
export const RISK_LABEL: Record<string, string> = {
  critical: "crítico",
  high: "alto",
  moderate: "moderado",
  low: "baixo",
};

// Action-plan reason strings embed the raw category ("categoria de risco
// critical"); translate those tokens so nothing English leaks to laypeople.
export function ptRisk(text: string): string {
  return text.replace(/\b(critical|high|moderate|low)\b/g, (w) => RISK_LABEL[w] ?? w);
}

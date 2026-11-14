import { RISK_LABEL, ptRisk } from "../labels";
import { riskScore10 } from "../format";

type Plan = { priority: string; reasons: string[]; actions: string[] };

type Props = {
  sel: Record<string, any>;
  plan: Plan | null;
  floodOk: boolean;
  onClose: () => void;
  onExportFlood: () => void;
};

const LEVEL_STYLE: Record<string, string> = {
  critical: "bg-error-container/40 text-error border-error/50",
  high: "bg-[#f59e0b]/15 text-[#fbbf24] border-[#f59e0b]/40",
  moderate: "bg-[#eab308]/15 text-[#fde047] border-[#eab308]/40",
  low: "bg-[#10b981]/15 text-[#6ee7b7] border-[#10b981]/40",
};

function Kpi({ label, value, sub, accent }: { label: string; value: string; sub?: string; accent?: string }) {
  return (
    <div className="p-space-sm rounded-lg bg-surface-container-low">
      <div className="font-label-mono-xs text-label-mono-xs text-on-surface-variant uppercase tracking-wider">
        {label}
      </div>
      <div className={`font-metric-lg text-metric-lg mt-space-xs ${accent ?? "text-on-surface"}`}>
        {value}
      </div>
      {sub && (
        <div className="font-label-mono-xs text-label-mono-xs text-outline mt-0.5">{sub}</div>
      )}
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between py-space-xs border-b border-outline-variant/40 last:border-0">
      <span className="font-body-sm text-body-sm text-on-surface-variant">{label}</span>
      <span className="font-label-mono-sm text-label-mono-sm text-on-surface">{value}</span>
    </div>
  );
}

export function TriagePanel({ sel, plan, floodOk, onClose, onExportFlood }: Props) {
  const cat = sel.risk_category as string;
  const exposurePct =
    Number.isFinite(sel.pop_exposed) && Number.isFinite(sel.population) && sel.population > 0
      ? `${Math.round((100 * sel.pop_exposed) / sel.population)}% do município`
      : undefined;

  return (
    <aside className="absolute top-space-md right-space-md z-40 w-[380px] max-h-[calc(100%-2rem)] overflow-y-auto no-scrollbar rounded-xl bg-surface-container-lowest/90 backdrop-blur-xl border border-outline-variant shadow-2xl">
      <div className="p-space-md border-b border-outline-variant">
        <div className="flex items-center justify-between gap-space-sm">
          <span className="font-label-mono-xs text-label-mono-xs text-tertiary-container tracking-wider uppercase font-semibold">
            Triagem de emergência
          </span>
          <button
            type="button"
            onClick={onClose}
            className="w-7 h-7 rounded bg-surface-container-low hover:bg-surface-container-high text-on-surface-variant hover:text-on-surface flex items-center justify-center transition-colors"
            title="Fechar"
          >
            <span className="material-symbols-outlined text-[16px]">close</span>
          </button>
        </div>
        <div className="mt-space-xs flex items-center justify-between gap-space-sm">
          <h2 className="font-headline-sm text-headline-sm text-on-surface font-semibold truncate">
            {sel.name}
          </h2>
          <span
            className={`px-space-sm py-0.5 rounded-full border font-label-mono-xs text-label-mono-xs font-semibold uppercase whitespace-nowrap ${
              LEVEL_STYLE[cat] ?? "bg-surface-container text-on-surface-variant border-outline-variant"
            }`}
          >
            Nível {RISK_LABEL[cat] ?? cat}
          </span>
        </div>
      </div>

      <div className="p-space-md grid grid-cols-3 gap-space-sm">
        <Kpi label="Score risco" value={riskScore10(sel.risk)} sub="/10" accent="text-tertiary-container" />
        <Kpi
          label="Pop. exposta"
          value={Number(sel.pop_exposed).toLocaleString("pt-BR")}
          sub={exposurePct}
        />
        <Kpi
          label="Área submersa"
          value={`${(100 * sel.flood_frac).toFixed(0)}%`}
          sub="SAR Sentinel-1"
        />
      </div>

      <div className="px-space-md pb-space-md">
        <div className="font-label-mono-xs text-label-mono-xs text-on-surface-variant uppercase tracking-wider mb-space-xs">
          Dados municipais
        </div>
        <div className="rounded-lg bg-surface-container-low px-space-sm">
          <Row label="População total" value={Number(sel.population).toLocaleString("pt-BR")} />
          <Row label="Chuva máx. 7 dias" value={`${Number(sel.precip_max7d_mm).toFixed(0)} mm`} />
          <Row
            label="Umidade do solo"
            value={`${(100 * (sel.soil_moisture_mean ?? 0)).toFixed(0)}%`}
          />
          <Row
            label="Área naturalmente inundável"
            value={`${(100 * (sel.sus_frac ?? 0)).toFixed(0)}%`}
          />
        </div>
      </div>

      {plan && (
        <div className="px-space-md pb-space-md">
          <div className="flex items-center justify-between mb-space-xs">
            <span className="font-label-mono-xs text-label-mono-xs text-on-surface-variant uppercase tracking-wider">
              Fatores de risco
            </span>
            <span className="font-label-mono-xs text-label-mono-xs text-primary font-medium uppercase">
              Prioridade {RISK_LABEL[plan.priority] ?? plan.priority}
            </span>
          </div>
          <ul className="rounded-lg bg-surface-container-low p-space-sm space-y-space-xs">
            {plan.reasons.map((r, i) => (
              <li key={i} className="flex gap-space-xs font-body-sm text-body-sm text-on-surface-variant">
                <span className="text-tertiary-container mt-0.5">▸</span>
                {ptRisk(r)}
              </li>
            ))}
          </ul>

          <div
            id="acoes"
            className="font-label-mono-xs text-label-mono-xs text-on-surface-variant uppercase tracking-wider mt-space-md mb-space-xs"
          >
            Diretrizes de ação
          </div>
          <ol className="space-y-space-xs">
            {plan.actions.map((a, i) => (
              <li key={i} className="flex gap-space-sm rounded-lg bg-surface-container-low p-space-sm">
                <span className="w-5 h-5 rounded-full bg-primary-container/20 text-primary font-label-mono-xs text-label-mono-xs flex items-center justify-center shrink-0 mt-0.5">
                  {i + 1}
                </span>
                <span className="font-body-sm text-body-sm text-on-surface">{ptRisk(a)}</span>
              </li>
            ))}
          </ol>
        </div>
      )}

      <div className="p-space-md border-t border-outline-variant flex flex-col gap-space-xs">
        {plan && (
          <a
            href="#acoes"
            className="h-9 rounded-lg bg-primary hover:bg-secondary-fixed text-on-primary flex items-center justify-center gap-space-xs font-body-sm text-body-sm font-medium transition-colors"
          >
            <span className="material-symbols-outlined text-[18px]">assignment</span>
            Ver Plano de Ação
          </a>
        )}
        <button
          type="button"
          onClick={onExportFlood}
          disabled={!floodOk}
          title={floodOk ? "Baixar polígonos de inundação (GeoJSON)" : "Camada de polígonos não gerada"}
          className="h-9 rounded-lg bg-surface-container hover:bg-surface-container-high disabled:opacity-40 disabled:cursor-not-allowed text-on-surface flex items-center justify-center gap-space-xs font-body-sm text-body-sm transition-colors"
        >
          <span className="material-symbols-outlined text-[18px]">download</span>
          Exportar Polígonos GeoJSON
        </button>
      </div>
    </aside>
  );
}

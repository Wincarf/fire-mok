import type { Vis } from "../vis";
import { SAR_PLATFORM } from "../format";

type Props = {
  layers: Vis;
  onToggle: (k: keyof Vis, v: boolean) => void;
  thresh: number;
  onThresh: (v: number) => void;
  summary: { exposed: number; critical: number };
  lastPass: string;
};

const LAYERS: { key: keyof Vis; name: string; chip: string; dot: string }[] = [
  { key: "flood", name: "Água onde não devia estar", chip: "SAR", dot: "bg-primary" },
  { key: "mask", name: "Simulador de detecção", chip: "σ0", dot: "bg-secondary" },
  { key: "sus", name: "Áreas naturalmente inundáveis", chip: "DEM", dot: "bg-tertiary-container" },
  { key: "muni", name: "Municípios por risco", chip: "IBGE", dot: "bg-error" },
];

const RISK = [
  { label: "crítico", cls: "bg-tertiary-container" },
  { label: "alto", cls: "bg-[#f59e0b]" },
  { label: "moderado", cls: "bg-[#eab308]" },
  { label: "baixo", cls: "bg-[#10b981]" },
];

export function LayersDrawer({ layers, onToggle, thresh, onThresh, summary, lastPass }: Props) {
  return (
    <aside className="fixed left-0 top-16 bottom-0 w-64 z-40 bg-surface-container-lowest border-r border-outline-variant flex flex-col justify-between">
      <div className="p-space-md flex flex-col gap-space-md overflow-y-auto no-scrollbar">
        <div className="px-space-sm py-space-xs flex items-center justify-between text-on-surface-variant">
          <span className="font-label-mono-xs text-label-mono-xs tracking-wider uppercase">
            Camadas &amp; Sensores
          </span>
          <span className="material-symbols-outlined text-[16px] text-outline">layers</span>
        </div>

        <div className="space-y-space-xs">
          {LAYERS.map((l) => (
            <label
              key={l.key}
              className="p-space-sm rounded-lg bg-surface-container-low flex items-center justify-between cursor-pointer hover:bg-surface-container transition-colors"
            >
              <span className="flex items-center gap-space-sm">
                <input
                  type="checkbox"
                  checked={layers[l.key]}
                  onChange={(e) => onToggle(l.key, e.target.checked)}
                  className="w-4 h-4 rounded-sm accent-primary"
                />
                <span className={`w-2 h-2 rounded-full ${l.dot} ${layers[l.key] ? "" : "opacity-30"}`} />
                <span className="font-body-sm text-body-sm text-on-surface">{l.name}</span>
              </span>
              <span className="font-label-mono-xs text-label-mono-xs text-on-surface-variant">
                {l.chip}
              </span>
            </label>
          ))}
        </div>

        <div className="px-space-sm">
          <div className="flex items-center justify-between">
            <span className="font-label-mono-xs text-label-mono-xs uppercase tracking-wider text-on-surface-variant">
              Limiar σ0 (backscatter)
            </span>
            <span className="font-label-mono-sm text-label-mono-sm text-primary font-medium">
              {thresh.toFixed(1)} dB
            </span>
          </div>
          <input
            type="range"
            min={-25}
            max={-10}
            step={0.5}
            value={thresh}
            onChange={(e) => onThresh(Number(e.target.value))}
            className="w-full mt-space-xs accent-primary"
            title="Limiar de retroespalhamento radar (σ0) usado para classificar água"
          />
          <div className="flex justify-between font-label-mono-xs text-label-mono-xs text-outline">
            <span>-25 dB (sensível)</span>
            <span>-10 dB (conserv.)</span>
          </div>
        </div>

        <div className="px-space-sm">
          <span className="font-label-mono-xs text-label-mono-xs uppercase tracking-wider text-on-surface-variant">
            Risco municipal
          </span>
          <div className="mt-space-xs grid grid-cols-2 gap-space-xs">
            {RISK.map((r) => (
              <span key={r.label} className="flex items-center gap-space-xs font-label-mono-xs text-label-mono-xs text-on-surface-variant">
                <i className={`w-2.5 h-2.5 rounded-sm ${r.cls}`} />
                {r.label}
              </span>
            ))}
          </div>
        </div>

        <div className="px-space-sm">
          <span className="font-label-mono-xs text-label-mono-xs uppercase tracking-wider text-on-surface-variant">
            Resumo da AOI
          </span>
          <div className="mt-space-xs p-space-sm rounded-lg bg-surface-container-low">
            <div className="flex items-baseline justify-between">
              <span className="font-metric-lg text-metric-lg text-on-surface">
                ~{summary.exposed.toLocaleString("pt-BR")}
              </span>
              <span className="font-label-mono-xs text-label-mono-xs text-tertiary-container font-semibold uppercase">
                {summary.critical} em risco crítico
              </span>
            </div>
            <div className="font-label-mono-xs text-label-mono-xs text-outline mt-space-xs">
              pessoas potencialmente afetadas
            </div>
          </div>
        </div>
      </div>

      <div className="p-space-md bg-surface-container-low border-t border-outline-variant">
        <div className="flex items-center justify-between mb-space-xs">
          <span className="font-label-mono-xs text-label-mono-xs text-on-surface-variant uppercase tracking-wider">
            Último Passe SAR
          </span>
          <span className="font-label-mono-xs text-label-mono-xs text-primary font-medium">
            {lastPass}
          </span>
        </div>
        <div className="flex items-center gap-space-xs text-on-surface-variant">
          <span className="material-symbols-outlined text-[14px] text-primary">satellite_alt</span>
          <span className="font-body-sm text-body-sm truncate">{SAR_PLATFORM}</span>
        </div>
      </div>
    </aside>
  );
}

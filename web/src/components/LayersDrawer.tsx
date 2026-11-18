import type { Vis } from "../vis";
import { fmtInt, SAR_PLATFORM } from "../format";
import { RISK_CATEGORIES, RISK_CHIP } from "../risk";
import type { MuniSummary } from "../stats";

type Props = {
  layers: Vis;
  onToggle: (k: keyof Vis, v: boolean) => void;
  summary: MuniSummary;
  lastPass: string;
};

const LAYERS: { key: keyof Vis; name: string; chip: string; dot: string }[] = [
  { key: "muni", name: "Municipalities by risk", chip: "IBGE", dot: "bg-error" },
  { key: "flood", name: "Water where it shouldn't be", chip: "SAR", dot: "bg-primary" },
  { key: "sus", name: "Naturally flood-prone areas", chip: "DEM", dot: "bg-tertiary-container" },
];

export function LayersDrawer({ layers, onToggle, summary, lastPass }: Props) {
  return (
    <aside className="fixed left-0 top-16 bottom-0 w-64 z-40 bg-surface-container-lowest border-r border-outline-variant flex flex-col justify-between">
      <div className="p-space-md flex flex-col gap-space-md overflow-y-auto no-scrollbar">
        <div className="px-space-sm py-space-xs flex items-center justify-between text-on-surface-variant">
          <span className="font-label-mono-xs text-label-mono-xs tracking-wider uppercase">
            Layers &amp; Sensors
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
          <span className="font-label-mono-xs text-label-mono-xs uppercase tracking-wider text-on-surface-variant">
            Municipal risk
          </span>
          <div className="mt-space-xs grid grid-cols-2 gap-space-xs">
            {RISK_CATEGORIES.map((r) => (
              <span key={r} className="flex items-center gap-space-xs font-label-mono-xs text-label-mono-xs text-on-surface-variant">
                <i className={`w-2.5 h-2.5 rounded-sm ${RISK_CHIP[r]}`} />
                {r}
              </span>
            ))}
          </div>
        </div>

        <div className="px-space-sm">
          <span className="font-label-mono-xs text-label-mono-xs uppercase tracking-wider text-on-surface-variant">
            AOI summary
          </span>
          <div className="mt-space-xs p-space-sm rounded-lg bg-surface-container-low">
            <div className="flex items-baseline justify-between">
              <span className="font-metric-lg text-metric-lg text-on-surface">
                ~{fmtInt(summary.exposed)}
              </span>
              <span className="font-label-mono-xs text-label-mono-xs text-tertiary-container font-semibold uppercase">
                {summary.critical} at critical risk
              </span>
            </div>
            <div className="font-label-mono-xs text-label-mono-xs text-outline mt-space-xs">
              people potentially affected
            </div>
          </div>
        </div>
      </div>

      <div className="p-space-md bg-surface-container-low border-t border-outline-variant">
        <div className="flex items-center justify-between mb-space-xs">
          <span className="font-label-mono-xs text-label-mono-xs text-on-surface-variant uppercase tracking-wider">
            Last SAR pass
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

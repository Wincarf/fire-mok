import type { RefObject, ReactNode } from "react";
import { RISK_LABEL } from "../labels";
import type { RiskCounts } from "../stats";

type Props = {
  zoom: number;
  onZoom: (d: 1 | -1) => void;
  mapRef: RefObject<HTMLDivElement | null>;
  containerRef: RefObject<HTMLDivElement | null>;
  counts: RiskCounts;
  children?: ReactNode;
};

const CHIP: Record<keyof RiskCounts, string> = {
  critical: "bg-error",
  high: "bg-[#f59e0b]",
  moderate: "bg-[#eab308]",
  low: "bg-[#10b981]",
};

export function MapHud({ zoom, onZoom, mapRef, containerRef, counts, children }: Props) {
  return (
    <div
      ref={containerRef}
      className="relative h-full overflow-hidden select-none cursor-crosshair bg-surface-container-lowest"
    >
      <div ref={mapRef} className="map-canvas" />

      {/* Risk legend — counts come from the real /api/municipalities payload */}
      <div className="absolute top-space-md left-space-md z-20 flex items-center gap-space-sm pointer-events-none">
        <div className="px-space-md py-space-xs rounded bg-surface-container-lowest/90 backdrop-blur-md border border-outline-variant flex items-center gap-space-md">
          <span className="font-label-mono-xs text-label-mono-xs text-on-surface font-semibold tracking-wider">
            RISCO MUNICIPAL
          </span>
          {(Object.keys(CHIP) as (keyof RiskCounts)[]).map((k) => (
            <span key={k} className="flex items-center gap-1.5 font-label-mono-xs text-label-mono-xs">
              <span className={`w-2.5 h-2.5 rounded-sm ${CHIP[k]}`} />
              <span className="text-on-surface-variant">{RISK_LABEL[k]}</span>
              <span className="text-primary font-medium">{counts[k]}</span>
            </span>
          ))}
        </div>
      </div>

      {/* Telemetry — only real values: live zoom */}
      <div className="absolute top-space-md right-space-md z-20 hidden lg:flex items-center pointer-events-none">
        <div className="px-space-md py-space-xs rounded bg-surface-container-lowest/90 backdrop-blur-md border border-outline-variant flex items-center gap-space-md font-label-mono-xs text-label-mono-xs">
          <div>
            <span className="text-outline">FONTE:</span>{" "}
            <span className="text-on-surface font-medium">S1 SAR + DEM + IBGE</span>
          </div>
          <div>
            <span className="text-outline">Z:</span>{" "}
            <span className="text-primary font-medium">{zoom.toFixed(1)}</span>
          </div>
        </div>
      </div>

      {/* GIS quickbar */}
      <div className="absolute top-20 right-space-md z-20 flex flex-col gap-space-xs">
        <button
          type="button"
          onClick={() => onZoom(1)}
          title="Aproximar"
          className="w-9 h-9 rounded bg-surface-container-low hover:bg-surface-container-high border border-outline-variant text-on-surface hover:text-primary shadow-md flex items-center justify-center transition-colors"
        >
          <span className="material-symbols-outlined text-[18px]">add</span>
        </button>
        <button
          type="button"
          onClick={() => onZoom(-1)}
          title="Afastar"
          className="w-9 h-9 rounded bg-surface-container-low hover:bg-surface-container-high border border-outline-variant text-on-surface hover:text-primary shadow-md flex items-center justify-center transition-colors"
        >
          <span className="material-symbols-outlined text-[18px]">remove</span>
        </button>
      </div>

      {children}
    </div>
  );
}

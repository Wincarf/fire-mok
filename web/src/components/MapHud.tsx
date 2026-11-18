import type { RefObject, PointerEvent } from "react";
import { RISK_CHIP, RISK_CATEGORIES } from "../risk";
import { sarSceneDate } from "../format";
import { SAR_SCENE_AFTER, SAR_SCENE_BEFORE } from "../mapStyle";
import type { RiskCounts } from "../stats";

type Props = {
  zoom: number;
  onZoom: (d: 1 | -1) => void;
  mapRef: RefObject<HTMLDivElement | null>;
  beforeRef: RefObject<HTMLDivElement | null>;
  containerRef: RefObject<HTMLDivElement | null>;
  counts: RiskCounts;
  compare: boolean;
  onCompare: () => void;
  showDuet?: boolean;
  duet?: boolean;
  onDuet?: () => void;
  splitLabels?: { left: string; right: string };
  split: number;
  onDividerDown: (e: PointerEvent<HTMLDivElement>) => void;
};

export function MapHud({
  zoom,
  onZoom,
  mapRef,
  beforeRef,
  containerRef,
  counts,
  compare,
  onCompare,
  showDuet,
  duet,
  onDuet,
  splitLabels,
  split,
  onDividerDown,
}: Props) {
  return (
    <div
      ref={containerRef}
      className="relative h-full overflow-hidden select-none cursor-crosshair bg-surface-container-lowest"
    >
      {compare && <div ref={beforeRef} className="map-canvas" />}
      <div
        ref={mapRef}
        className={`map-canvas${compare ? " z-[2]" : ""}`}
        style={compare ? { clipPath: `inset(0 0 0 ${split}%)` } : undefined}
      />

      {/* Risk legend — municipal category counts */}
      <div className="absolute top-space-md left-space-md z-20 flex items-center gap-space-sm pointer-events-none">
        <div className="px-space-md py-space-xs rounded bg-surface-container-lowest/90 backdrop-blur-md border border-outline-variant flex items-center gap-space-md">
          <span className="font-label-mono-xs text-label-mono-xs text-on-surface font-semibold tracking-wider">
            MUNICIPAL RISK
          </span>
          {RISK_CATEGORIES.map((k) => (
            <span key={k} className="flex items-center gap-1.5 font-label-mono-xs text-label-mono-xs">
              <span className={`w-2.5 h-2.5 rounded-sm ${RISK_CHIP[k]}`} />
              <span className="text-on-surface-variant">{k}</span>
              <span className="text-primary font-medium">{counts[k]}</span>
            </span>
          ))}
        </div>
      </div>

      {/* SAR scene dates — only while the before/after swipe is on */}
      {compare && (
        <div className="absolute top-space-md left-1/2 -translate-x-1/2 z-20 flex items-center gap-space-sm pointer-events-none">
          <div className="px-space-md py-space-xs rounded bg-surface-container-lowest/90 backdrop-blur-md border border-outline-variant flex items-center gap-space-sm">
            <span className="w-2.5 h-2.5 rounded-full bg-primary" />
            <span className="font-label-mono-xs text-label-mono-xs text-on-surface font-semibold tracking-wider">
              {splitLabels?.left ?? `RECESSION · ${sarSceneDate(SAR_SCENE_BEFORE).toUpperCase()}`}
            </span>
          </div>
          <div className="px-space-md py-space-xs rounded bg-surface-container-lowest/90 backdrop-blur-md border border-outline-variant flex items-center gap-space-sm">
            <span className="w-2.5 h-2.5 rounded-full bg-error animate-pulse" />
            <span className="font-label-mono-xs text-label-mono-xs text-on-surface font-semibold tracking-wider">
              {splitLabels?.right ?? `SAR PEAK · ${sarSceneDate(SAR_SCENE_AFTER).toUpperCase()}`}
            </span>
          </div>
        </div>
      )}

      {/* Telemetry — only real values: live zoom */}
      <div className="absolute top-space-md right-space-md z-20 hidden lg:flex items-center pointer-events-none">
        <div className="px-space-md py-space-xs rounded bg-surface-container-lowest/90 backdrop-blur-md border border-outline-variant flex items-center gap-space-md font-label-mono-xs text-label-mono-xs">
          <div>
            <span className="text-outline">SOURCE:</span>{" "}
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
          title="Zoom in"
          className="w-9 h-9 rounded bg-surface-container-low hover:bg-surface-container-high border border-outline-variant text-on-surface hover:text-primary shadow-md flex items-center justify-center transition-colors"
        >
          <span className="material-symbols-outlined text-[18px]">add</span>
        </button>
        <button
          type="button"
          onClick={() => onZoom(-1)}
          title="Zoom out"
          className="w-9 h-9 rounded bg-surface-container-low hover:bg-surface-container-high border border-outline-variant text-on-surface hover:text-primary shadow-md flex items-center justify-center transition-colors"
        >
          <span className="material-symbols-outlined text-[18px]">remove</span>
        </button>
        <button
          type="button"
          onClick={onCompare}
          title="Compare SAR — recession (Jun 04) vs peak (May 11)"
          className={`w-9 h-9 rounded border shadow-md flex items-center justify-center transition-colors ${
            compare
              ? "bg-primary/20 border-primary text-primary"
              : "bg-surface-container-low hover:bg-surface-container-high border-outline-variant text-on-surface hover:text-primary"
          }`}
        >
          <span className="material-symbols-outlined text-[18px]">compare</span>
        </button>
        {showDuet && onDuet && (
          <button
            type="button"
            onClick={onDuet}
            title="Duet — Sentinel-1 C-band (2024) vs NISAR L-band"
            className={`w-9 h-9 rounded border shadow-md flex items-center justify-center transition-colors ${
              duet
                ? "bg-primary/20 border-primary text-primary"
                : "bg-surface-container-low hover:bg-surface-container-high border-outline-variant text-on-surface hover:text-primary"
            }`}
          >
            <span className="material-symbols-outlined text-[18px]">swap_horiz</span>
          </button>
        )}
      </div>

      {/* Swipe divider — centered on the clip boundary (group is ~32px wide) */}
      {compare && (
        <div
          className="absolute top-0 bottom-0 z-30 flex items-center justify-center cursor-ew-resize group -translate-x-1/2"
          style={{ left: `${split}%` }}
          onPointerDown={onDividerDown}
        >
          <div className="w-0.5 h-full bg-primary shadow-[0_0_12px_#4cd7f6]" />
          <div className="absolute w-8 h-8 rounded-full bg-surface-container-high border border-outline-variant shadow-xl flex items-center justify-center text-primary transition-transform group-hover:scale-110">
            <span className="material-symbols-outlined text-[18px]">drag_indicator</span>
          </div>
        </div>
      )}
    </div>
  );
}

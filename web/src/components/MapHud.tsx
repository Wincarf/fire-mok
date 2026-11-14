import type { RefObject, ReactNode, PointerEvent } from "react";

type Props = {
  zoom: number;
  onZoom: (d: 1 | -1) => void;
  split: number;
  topAnim: boolean;
  beforeRef: RefObject<HTMLDivElement | null>;
  afterRef: RefObject<HTMLDivElement | null>;
  containerRef: RefObject<HTMLDivElement | null>;
  onDividerDown: (e: PointerEvent<HTMLDivElement>) => void;
  onCinematic: () => void;
  children?: ReactNode;
};

export function MapHud({
  zoom,
  onZoom,
  split,
  topAnim,
  beforeRef,
  afterRef,
  containerRef,
  onDividerDown,
  onCinematic,
  children,
}: Props) {
  return (
    <div
      ref={containerRef}
      className="relative h-full overflow-hidden select-none cursor-crosshair bg-surface-container-lowest"
    >
      <div ref={beforeRef} className="map-canvas" />
      <div
        ref={afterRef}
        className={`map-canvas z-[2]${topAnim ? " divider-anim" : ""}`}
        style={{ clipPath: `inset(0 0 0 ${split}%)` }}
      />

      {/* Floating legend pills — recessão (esq) vs pico (dir) */}
      <div className="absolute top-space-md left-space-md z-20 flex items-center gap-space-sm pointer-events-none">
        <div className="px-space-md py-space-xs rounded bg-surface-container-lowest/90 backdrop-blur-md border border-outline-variant flex items-center gap-space-sm">
          <span className="w-2.5 h-2.5 rounded-full bg-primary" />
          <span className="font-label-mono-xs text-label-mono-xs text-on-surface font-semibold tracking-wider">
            RECESSÃO · 04/JUN/24
          </span>
        </div>
        <div className="px-space-md py-space-xs rounded bg-surface-container-lowest/90 backdrop-blur-md border border-outline-variant flex items-center gap-space-sm">
          <span className="w-2.5 h-2.5 rounded-full bg-error animate-pulse" />
          <span className="font-label-mono-xs text-label-mono-xs text-on-surface font-semibold tracking-wider">
            PICO SAR · 11/MAI/24
          </span>
        </div>
      </div>

      {/* Telemetry HUD — only real values: S1 IW GRD 10m, VV pol, live zoom */}
      <div className="absolute top-space-md right-space-md z-20 hidden lg:flex items-center pointer-events-none">
        <div className="px-space-md py-space-xs rounded bg-surface-container-lowest/90 backdrop-blur-md border border-outline-variant flex items-center gap-space-md font-label-mono-xs text-label-mono-xs">
          <div>
            <span className="text-outline">RES:</span>{" "}
            <span className="text-primary font-medium">10m SAR IW</span>
          </div>
          <div>
            <span className="text-outline">POL:</span>{" "}
            <span className="text-on-surface font-medium">VV</span>
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
        <button
          type="button"
          onClick={onCinematic}
          title="Modo cinemático 3D"
          className="w-9 h-9 rounded bg-surface-container-low hover:bg-surface-container-high border border-outline-variant text-on-surface hover:text-primary shadow-md flex items-center justify-center transition-colors"
        >
          <span className="material-symbols-outlined text-[18px]">movie</span>
        </button>
      </div>

      {/* Swipe divider — centered on the clip boundary (group is ~32px wide) */}
      <div
        className={`absolute top-0 bottom-0 z-30 flex items-center justify-center cursor-ew-resize group -translate-x-1/2${
          topAnim ? " divider-anim" : ""
        }`}
        style={{ left: `${split}%` }}
        onPointerDown={onDividerDown}
      >
        <div className="w-0.5 h-full bg-primary shadow-[0_0_12px_#4cd7f6]" />
        <div className="absolute w-8 h-8 rounded-full bg-surface-container-high border border-outline-variant shadow-xl flex items-center justify-center text-primary transition-transform group-hover:scale-110">
          <span className="material-symbols-outlined text-[18px]">drag_indicator</span>
        </div>
      </div>

      {children}
    </div>
  );
}

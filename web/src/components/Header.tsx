type Props = {
  tiler: "loading" | "online" | "offline";
  tilerMs: number | null;
  coords: { lng: number; lat: number } | null;
  onExport: () => void;
  onStory: () => void;
};

const STATUS = {
  loading: { dot: "bg-outline", text: "CONECTANDO…", textCls: "text-on-surface-variant" },
  online: { dot: "bg-primary animate-pulse", text: "ONLINE", textCls: "text-primary" },
  offline: { dot: "bg-error", text: "OFFLINE", textCls: "text-error" },
} as const;

export function Header({ tiler, tilerMs, coords, onExport, onStory }: Props) {
  const st = STATUS[tiler];
  return (
    <header className="fixed top-0 inset-x-0 z-50 h-16 bg-surface-container-lowest/90 backdrop-blur-xl border-b border-outline-variant">
      <div className="h-full px-gutter-desktop flex items-center justify-between gap-space-lg">
        <div className="flex items-center gap-space-md min-w-0">
          <span className="font-headline-sm text-headline-sm font-bold tracking-tight text-on-surface">
            Fire Mok
          </span>
          <span className="px-space-sm py-0.5 rounded-full bg-surface-container-high text-primary font-label-mono-xs text-label-mono-xs whitespace-nowrap">
            v1.2 — Sentinel-1
          </span>
          <div className="hidden lg:flex items-center gap-space-xs px-space-sm py-1 rounded bg-surface-container-low">
            <span className={`w-2 h-2 rounded-full ${st.dot}`} />
            <span className="font-label-mono-xs text-label-mono-xs text-on-surface-variant">
              rio-tiler:
            </span>
            <span className={`font-label-mono-xs text-label-mono-xs font-medium ${st.textCls}`}>
              {tiler === "online" && tilerMs !== null ? `ONLINE (${tilerMs}ms)` : st.text}
            </span>
          </div>
        </div>

        <div className="flex items-center gap-space-md">
          <div className="hidden md:flex items-center gap-space-sm px-space-md py-1 rounded-full bg-surface-container-low">
            <span className="material-symbols-outlined text-primary text-[16px]">near_me</span>
            <span className="font-label-mono-xs text-label-mono-xs text-on-surface whitespace-nowrap">
              Lat: <span className="text-primary">{coords ? `${coords.lat.toFixed(4)}°` : "—"}</span>{" "}
              Lon: <span className="text-primary">{coords ? `${coords.lng.toFixed(4)}°` : "—"}</span>
            </span>
          </div>
          <button
            type="button"
            onClick={onStory}
            className="h-9 px-space-md rounded-lg border border-primary-container/60 text-primary hover:bg-primary-container/15 flex items-center gap-space-xs transition-colors"
          >
            <span className="material-symbols-outlined text-[18px]">play_arrow</span>
            <span className="font-body-sm text-body-sm font-medium hidden sm:inline">História</span>
          </button>
          <button
            type="button"
            onClick={onExport}
            className="h-9 px-space-md rounded-lg bg-primary hover:bg-secondary-fixed text-on-primary flex items-center gap-space-xs transition-colors"
          >
            <span className="material-symbols-outlined text-[18px]">download</span>
            <span className="font-body-sm text-body-sm font-medium hidden sm:inline">Exportar</span>
          </button>
        </div>
      </div>
    </header>
  );
}

import { fmtInt, ptDate } from "../format";

type Beat = {
  date: string;
  label: string;
  flood_km2: number;
  munis_affected: number;
  pop_exposed_est: number;
};

type Props = {
  beats: Beat[];
  beat: number | null;
  playing: boolean;
  onBeat: (i: number | null) => void;
  onPlay: () => void;
  onCard: (i: number) => void;
};

const LABELS: Record<string, string> = {
  peak: "PEAK",
  recession: "RECESSION",
  calm: "CALM",
};

/** The Dance — three real Sentinel-1 beats over the May-2024 flood. */
export function ChoreoBar({ beats, beat, playing, onBeat, onPlay, onCard }: Props) {
  const active = beat !== null ? beats[beat] : null;
  return (
    <div className="absolute bottom-3 inset-x-3 z-30 rounded-xl bg-surface-container-lowest/85 backdrop-blur-xl border border-outline-variant px-space-md py-space-sm">
      <div className="flex items-center gap-space-md">
        <button
          type="button"
          onClick={onPlay}
          title="Play the dance — animated flood extent"
          className={`w-10 h-10 shrink-0 rounded-full flex items-center justify-center transition-colors ${
            playing
              ? "bg-primary text-on-primary"
              : "bg-surface-container-high text-primary hover:bg-primary/15 border border-outline-variant"
          }`}
        >
          <span className="material-symbols-outlined text-[20px]">
            {playing ? "pause" : "play_arrow"}
          </span>
        </button>

        <div className="flex items-center gap-space-xs min-w-0">
          {beats.map((b, i) => (
            <button
              key={b.date}
              type="button"
              onClick={() => onBeat(i === beat ? null : i)}
              title={`${b.date} — ${b.flood_km2} km²`}
              className={`px-space-sm py-1 rounded-lg border flex items-center gap-space-xs transition-colors ${
                i === beat
                  ? "bg-primary/20 border-primary text-primary"
                  : "bg-surface-container-low border-outline-variant text-on-surface hover:border-primary/60"
              }`}
            >
              <span className={`w-2 h-2 rounded-full ${i === beat ? "bg-primary" : "bg-outline"} ${i === beat && playing ? "animate-pulse" : ""}`} />
              <span className="font-label-mono-xs text-label-mono-xs whitespace-nowrap">
                {ptDate(b.date, true)} · {LABELS[b.label] ?? b.label.toUpperCase()}
              </span>
            </button>
          ))}
        </div>

        <div className="flex-1" />

        {active ? (
          <div className="hidden md:flex items-center gap-space-md font-label-mono-xs text-label-mono-xs whitespace-nowrap">
            <span className="text-on-surface-variant">WATER</span>
            <span className="text-primary font-semibold">{active.flood_km2} km²</span>
            <span className="text-on-surface-variant">MUNIS</span>
            <span className="text-on-surface font-semibold">{active.munis_affected}</span>
            <span className="text-on-surface-variant">POP</span>
            <span className="text-on-surface font-semibold">~{fmtInt(active.pop_exposed_est)}</span>
          </div>
        ) : (
          <span className="hidden md:inline font-label-mono-xs text-label-mono-xs text-on-surface-variant whitespace-nowrap">
            pick a beat — flood extent, day by day
          </span>
        )}

        <button
          type="button"
          onClick={() => active && onCard(beat!)}
          disabled={beat === null}
          title="Monday-morning alert card (pt-BR, WhatsApp-ready)"
          className={`h-9 px-space-md rounded-lg flex items-center gap-space-xs transition-colors ${
            beat !== null
              ? "bg-primary hover:bg-secondary-fixed text-on-primary"
              : "bg-surface-container-high text-outline cursor-not-allowed"
          }`}
        >
          <span className="material-symbols-outlined text-[16px]">notifications_active</span>
          <span className="font-body-sm text-body-sm font-medium hidden sm:inline">Monday card</span>
        </button>
      </div>
    </div>
  );
}

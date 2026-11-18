import { STORY } from "../story";
import { sarSceneDate } from "../format";
import { SAR_SCENE_AFTER, SAR_SCENE_BEFORE } from "../mapStyle";

type Props = {
  step: number | null;
  onChapter: (i: number) => void;
};

export function Timeline({ step, onChapter }: Props) {
  return (
    <div className="absolute bottom-3 inset-x-3 z-30 rounded-xl bg-surface-container-lowest/85 backdrop-blur-xl border border-outline-variant px-space-md py-space-sm">
      <div className="flex items-center justify-between gap-space-md">
        <span className="font-label-mono-xs text-label-mono-xs text-on-surface-variant uppercase tracking-wider whitespace-nowrap">
          Timeline · May–Jun 2024
        </span>
        <div className="flex items-center gap-space-md font-label-mono-xs text-label-mono-xs">
          <span className="flex items-center gap-space-xs whitespace-nowrap">
            <span className="w-2 h-2 rounded-full bg-error" />
            <span className="text-on-surface-variant">SAR PEAK</span>
            <span className="text-on-surface font-medium">{sarSceneDate(SAR_SCENE_AFTER).toUpperCase()}</span>
          </span>
          <span className="flex items-center gap-space-xs whitespace-nowrap">
            <span className="w-2 h-2 rounded-full bg-primary" />
            <span className="text-on-surface-variant">RECESSION</span>
            <span className="text-on-surface font-medium">{sarSceneDate(SAR_SCENE_BEFORE).toUpperCase()}</span>
          </span>
        </div>
      </div>

      <div className="relative mt-space-sm">
        <div className="absolute top-[9px] inset-x-4 h-0.5 bg-outline-variant/60" />
        <div className="relative flex">
          {STORY.map((s, i) => {
            const active = step === i;
            const visited = step !== null && i < step;
            return (
              <button
                key={i}
                type="button"
                onClick={() => onChapter(i)}
                title={`${i + 1}. ${s.title}`}
                className="flex-1 flex flex-col items-center gap-space-xs group min-w-0"
              >
                <span
                  className={`w-5 h-5 rounded-full border-2 flex items-center justify-center transition-all ${
                    active
                      ? "bg-primary border-primary shadow-[0_0_10px_#4cd7f6]"
                      : visited
                        ? "bg-primary-container/40 border-primary-container text-primary"
                        : "bg-surface-container-high border-outline-variant group-hover:border-primary"
                  }`}
                >
                  <span
                    className={`font-label-mono-xs text-label-mono-xs ${
                      active ? "text-on-primary font-bold" : visited ? "text-primary" : "text-on-surface-variant group-hover:text-primary"
                    }`}
                  >
                    {i + 1}
                  </span>
                </span>
                <span
                  className={`font-label-mono-xs text-label-mono-xs uppercase tracking-wide truncate max-w-full px-1 transition-colors ${
                    active ? "text-primary" : "text-on-surface-variant group-hover:text-on-surface"
                  }`}
                >
                  {s.title}
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

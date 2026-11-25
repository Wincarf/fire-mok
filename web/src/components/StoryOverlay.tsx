import { STORY_UI, type Lang } from "../i18n";
import type { Step } from "../story";

type Props = {
  index: number;
  total: number;
  step: Step;
  lang: Lang;
  onPrev: () => void;
  onNext: () => void;
  onSkip: () => void;
  onRestart: () => void;
};

const ghost =
  "rounded-lg px-space-md py-space-xs bg-surface-container-high hover:bg-surface-container-highest text-on-surface font-body-sm text-body-sm transition-colors";
const primary =
  "rounded-lg px-space-md py-space-xs bg-primary hover:bg-secondary-fixed text-on-primary font-body-sm text-body-sm font-semibold transition-colors";

export function StoryOverlay({ index, total, step, lang, onPrev, onNext, onSkip, onRestart }: Props) {
  const last = index === total - 1;
  const ui = STORY_UI[lang];
  return (
    <div className="absolute bottom-24 left-1/2 -translate-x-1/2 z-30 w-[min(480px,90%)] rounded-xl bg-surface-container-lowest/85 backdrop-blur-xl border border-outline-variant shadow-2xl p-space-lg">
      <span className="font-label-mono-xs text-label-mono-xs text-primary tracking-widest uppercase">
        {ui.stepOf(index + 1, total)}
      </span>
      <h2 className="font-headline-sm text-headline-sm text-on-surface font-semibold mt-space-xs">
        {step.title[lang]}
      </h2>
      <p className="font-body-md text-body-md text-on-surface-variant mt-space-xs leading-relaxed">
        {step.text[lang]}
      </p>
      <div className="flex gap-space-sm justify-end mt-space-md">
        {!last && (
          <button type="button" className={ghost} onClick={onSkip}>
            {ui.skip}
          </button>
        )}
        {index > 0 && (
          <button type="button" className={ghost} onClick={onPrev}>
            {ui.back}
          </button>
        )}
        {last && (
          <button type="button" className={ghost} onClick={onRestart}>
            {ui.restart}
          </button>
        )}
        <button type="button" className={primary} onClick={onNext}>
          {last ? ui.explore : ui.next}
        </button>
      </div>
    </div>
  );
}

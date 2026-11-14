import type { Step } from "../story";

type Props = {
  index: number;
  total: number;
  step: Step;
  onPrev: () => void;
  onNext: () => void;
  onSkip: () => void;
  onRestart: () => void;
};

export function StoryOverlay({ index, total, step, onPrev, onNext, onSkip, onRestart }: Props) {
  const last = index === total - 1;
  return (
    <div className="story">
      <span className="story-count">PASSO {index + 1}/{total}</span>
      <h2>{step.title}</h2>
      <p>{step.text}</p>
      <div className="story-nav">
        {!last && <button className="ghost" onClick={onSkip}>pular</button>}
        {index > 0 && <button className="ghost" onClick={onPrev}>◂ voltar</button>}
        {last && <button className="ghost" onClick={onRestart}>recomeçar</button>}
        <button className="primary" onClick={onNext}>{last ? "explorar ▸" : "avançar ▸"}</button>
      </div>
    </div>
  );
}

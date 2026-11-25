// The first-screen hero: the real flood extent lights up over a dark basemap
// while the headline and real numbers fade in. One CTA hands off to the app
// (which starts the guided story). pt-BR/EN, driven by the i18n dictionary.
import { useEffect, useRef, useState } from "react";
import { LANDING, type Lang } from "../i18n";
import type { Choreo } from "../api";
import { createHeroMap } from "./heroMap";

type Props = {
  lang: Lang;
  onLang: (l: Lang) => void;
  choreo: Choreo | null;
  onEnter: () => void;
};

const compact = (v: number, lang: Lang) =>
  v.toLocaleString(lang === "pt" ? "pt-BR" : "en-US", {
    notation: "compact",
    maximumFractionDigits: 1,
  });

const decimal = (v: number, lang: Lang) =>
  v.toLocaleString(lang === "pt" ? "pt-BR" : "en-US", {
    maximumFractionDigits: 1,
  });

export function Landing({ lang, onLang, choreo, onEnter }: Props) {
  const mapEl = useRef<HTMLDivElement>(null);
  const [mapOk, setMapOk] = useState(true);
  const [leaving, setLeaving] = useState(false);
  const t = LANDING[lang];

  useEffect(() => {
    try {
      return createHeroMap(mapEl.current!);
    } catch (err) {
      console.warn("hero map failed (WebGL?):", err);
      setMapOk(false);
    }
  }, []);

  // the beat holding the May-11 peak — same source the Dance uses
  const peak =
    choreo?.beats?.find((b) => b.label === "peak") ?? choreo?.beats?.[0] ?? null;

  const enter = () => {
    if (leaving) return;
    setLeaving(true);
    // let the overlay dissolve over the already-mounted app, then unmount
    window.setTimeout(onEnter, 450);
  };

  return (
    <div
      className={`fixed inset-0 z-[70] bg-surface-container-lowest text-on-surface transition-opacity duration-500 motion-reduce:transition-none ${
        leaving ? "opacity-0 pointer-events-none" : "opacity-100"
      }`}
    >
      {/* real map — or a quiet gradient when WebGL is unavailable.
          position must be inline: MapLibre stamps position:relative on a
          container it finds `static`, and in dev the Tailwind sheet can apply
          after the map constructor measures — leaving a 0-height map. */}
      <div
        ref={mapEl}
        style={{ position: "absolute", inset: 0 }}
        aria-hidden="true"
      />
      {!mapOk && (
        <div className="absolute inset-0 bg-gradient-to-b from-surface-container-lowest via-surface-container-low to-surface-container-lowest" />
      )}

      {/* cinematic framing: soft vignette + bottom legibility gradient */}
      <div className="absolute inset-0 pointer-events-none bg-[radial-gradient(ellipse_at_center,transparent_55%,rgba(10,14,24,0.55)_100%)]" />
      <div className="absolute inset-x-0 bottom-0 h-[62%] pointer-events-none bg-gradient-to-t from-surface-container-lowest via-surface-container-lowest/70 to-transparent" />

      {/* language switch */}
      <div className="absolute top-4 right-4 sm:top-6 sm:right-6 flex rounded-full border border-outline-variant bg-surface-container-lowest/70 backdrop-blur-md overflow-hidden">
        {(["pt", "en"] as Lang[]).map((l) => (
          <button
            key={l}
            type="button"
            onClick={() => onLang(l)}
            aria-pressed={lang === l}
            className={`px-space-md py-1.5 font-label-mono-sm text-label-mono-sm transition-colors ${
              lang === l
                ? "bg-primary text-on-primary font-semibold"
                : "text-on-surface-variant hover:text-on-surface"
            }`}
          >
            {l === "pt" ? "PT" : "EN"}
          </button>
        ))}
      </div>

      {/* headline block — anchored low-left, text sits on the gradient */}
      <div className="absolute inset-x-0 bottom-0 px-gutter-desktop pb-24 sm:pb-16">
        <div className="max-w-[640px] sm:pl-[4vw]">
          <p className="hero-rise font-label-mono-sm text-label-mono-sm text-on-surface-variant">
            {t.dateline}
          </p>
          <h1 className="hero-rise font-display-lg text-display-lg-mobile sm:text-display-lg mt-space-sm text-on-surface">
            {t.title}
          </h1>
          <p className="hero-rise-delayed font-body-lg text-body-lg text-on-surface-variant mt-space-md max-w-[52ch]">
            {t.sub}
          </p>

          {peak && (
            <div className="hero-rise-delayed mt-space-lg flex flex-wrap gap-x-space-xl gap-y-space-sm">
              <div>
                <div className="font-metric-xl text-metric-xl text-on-surface">
                  {decimal(peak.flood_km2, lang)}
                </div>
                <div className="font-label-mono-xs text-label-mono-xs text-outline mt-0.5">
                  {t.statArea}
                </div>
              </div>
              <div>
                <div className="font-metric-xl text-metric-xl text-on-surface">
                  ~{compact(peak.pop_exposed_est, lang)}
                </div>
                <div className="font-label-mono-xs text-label-mono-xs text-outline mt-0.5">
                  {t.statPop}
                </div>
              </div>
              <div>
                <div className="font-metric-xl text-metric-xl text-on-surface">
                  {peak.munis_affected}
                </div>
                <div className="font-label-mono-xs text-label-mono-xs text-outline mt-0.5">
                  {t.statMunis}
                </div>
              </div>
            </div>
          )}

          <div className="hero-rise-delayed mt-space-xl">
            <button
              type="button"
              onClick={enter}
              className="h-12 px-space-xl rounded-lg bg-primary hover:bg-secondary-fixed text-on-primary font-body-lg text-body-lg font-semibold inline-flex items-center gap-space-sm transition-colors"
            >
              {t.cta}
              <span className="material-symbols-outlined text-[20px]">arrow_forward</span>
            </button>
          </div>
        </div>
      </div>

      {/* sources + disclaimer */}
      <div className="absolute bottom-0 inset-x-0 px-gutter-desktop py-3 flex flex-wrap items-center justify-between gap-x-space-lg gap-y-1 font-label-mono-xs text-label-mono-xs text-outline">
        <span>{t.sources}</span>
        <span>{t.disclaimer}</span>
      </div>
    </div>
  );
}

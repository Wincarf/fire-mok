import { useEffect, useRef, useState } from "react";
import { STORY } from "../story";
import { storyFlight } from "../scene/flight";
import type { World } from "../scene/world";

type Status = "loading" | "ready" | "error";

export default function CinematicMode({ onExit }: { onExit: () => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const worldRef = useRef<World | null>(null);
  const flightTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [status, setStatus] = useState<Status>("loading");
  const [note, setNote] = useState<string | null>(null);
  const [chapter, setChapter] = useState<number | null>(null);
  const [shooting, setShooting] = useState(false);
  const [stats, setStats] = useState<{ floodKm2: number; floodPct: number } | null>(null);

  useEffect(() => {
    let dead = false;
    const canvas = canvasRef.current!;
    (async () => {
      try {
        const mod = await import("../scene/world");
        const data = await mod.loadSceneData();
        const world = await mod.createWorld(canvas, data);
        if (dead) {
          world.dispose();
          return;
        }
        worldRef.current = world;
        setStats(world.stats);
        setStatus("ready");
        // risk prisms + buildings are nice-to-have — fetch in background
        import("../scene/risk").then(async (r) => {
          const fc = await r.fetchMunicipalities();
          if (dead || !fc) return;
          const T = await import("three");
          if (!dead) world.addObject(r.buildRiskPrisms(T, r.riskShapes(fc, world.origin), world.elevAt));
        });
        import("../scene/buildings").then(async (b) => {
          const list = await b.fetchBuildings(data.meta.bounds, world.origin);
          if (dead) return;
          if (list.length === 0) {
            setNote("prédios indisponíveis (OpenStreetMap offline)");
            return;
          }
          const T = await import("three");
          if (!dead) world.addObject(b.buildBuildingsMesh(T, list));
        });
      } catch {
        if (!dead) setStatus("error");
      }
    })();

    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onExit();
    const onResize = () => {
      const w = worldRef.current;
      if (w) w.resize(canvas.clientWidth, canvas.clientHeight);
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("resize", onResize);
    return () => {
      dead = true;
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", onResize);
      if (flightTimer.current) clearTimeout(flightTimer.current);
      worldRef.current?.dispose();
      worldRef.current = null;
    };
  }, [onExit]);

  const stopFlight = () => {
    if (flightTimer.current) clearTimeout(flightTimer.current);
    flightTimer.current = null;
    setChapter(null);
  };

  const startFlight = () => {
    const w = worldRef.current;
    if (!w) return;
    const kfs = storyFlight(STORY, w.origin);
    let i = 0;
    const leg = () => {
      const kf = kfs[i];
      setChapter(i);
      w.flyTo(kf.pos, kf.look, kf.ms);
      i += 1;
      flightTimer.current = i < kfs.length ? setTimeout(leg, kf.ms + 400) : setTimeout(() => setChapter(null), kf.ms);
    };
    leg();
  };

  const shot = async () => {
    const w = worldRef.current;
    if (!w || shooting) return;
    setShooting(true);
    const { exportPoster } = await import("../scene/poster");
    if (!(await exportPoster(w))) setNote("export falhou — contexto WebGL indisponível");
    setShooting(false);
  };

  const preset = (kind: "rio" | "aerea" | "cidade") => {
    const w = worldRef.current;
    if (!w) return;
    stopFlight();
    const { w: W, d: D, maxH } = w.extent;
    const P = {
      rio: { pos: [-W * 0.1, Math.max(1800, maxH * 2.2), -D * 0.38] as const, look: [0, 400, 0] as const },
      aerea: { pos: [0, maxH * 8 + 22000, -D * 0.45] as const, look: [0, 0, 0] as const },
      cidade: { pos: [W * 0.12, 1500, D * 0.18] as const, look: [W * 0.2, 500, D * 0.12] as const },
    }[kind];
    w.flyTo([...P.pos], [...P.look], 4200);
  };

  const btn =
    "px-3 h-9 rounded bg-surface-container-low hover:bg-surface-container-high border border-outline-variant text-on-surface hover:text-primary font-label-mono-xs text-[11px] tracking-wider flex items-center gap-1.5 transition-colors disabled:opacity-40";

  return (
    <div className="fixed inset-0 z-50 bg-black">
      <canvas ref={canvasRef} className="w-full h-full block" onPointerDown={stopFlight} />

      {status === "loading" && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-surface-container-lowest">
          <span className="material-symbols-outlined text-primary text-4xl animate-pulse">movie</span>
          <p className="font-label-mono-xs text-label-mono-xs text-outline tracking-widest">
            CARREGANDO CENA 3D · DEM + MÁSCARA DE ENCHENTE
          </p>
        </div>
      )}

      {status === "error" && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 bg-surface-container-lowest">
          <span className="material-symbols-outlined text-error text-4xl">cloud_off</span>
          <p className="font-label-mono-xs text-label-mono-xs text-on-surface tracking-widest">
            DADOS INDISPONÍVEIS — API /api/scene NÃO RESPONDEU
          </p>
          <button type="button" className={btn} onClick={onExit}>
            <span className="material-symbols-outlined text-[16px]">arrow_back</span>
            Voltar
          </button>
        </div>
      )}

      {status === "ready" && (
        <>
          {/* real flood quantification — same mask that paints the water */}
          {stats && (
            <div className="absolute top-6 left-4 flex flex-col gap-1.5">
              <div className="px-3 py-1.5 rounded bg-surface-container-lowest/80 backdrop-blur-md border border-outline-variant font-label-mono-xs text-[11px] text-on-surface flex items-center gap-2">
                <span className="w-2.5 h-2.5 rounded-full bg-primary" />
                {stats.floodKm2.toFixed(0)} KM² SOB ÁGUA · {stats.floodPct.toFixed(1)}% DA AOI
              </div>
              <div className="px-3 py-1.5 rounded bg-surface-container-lowest/80 backdrop-blur-md border border-outline-variant font-label-mono-xs text-[10px] text-outline flex items-center gap-2">
                <span className="w-2.5 h-2.5 rounded-sm" style={{ background: "linear-gradient(90deg,#c9b458,#d94f3d,#ff2d55)" }} />
                PRISMAS = RISCO MUNICIPAL (ALTURA × ÍNDICE)
              </div>
            </div>
          )}

          {chapter !== null && (
            <div className="absolute top-6 inset-x-0 flex justify-center pointer-events-none">
              <div className="px-4 py-2 rounded bg-surface-container-lowest/80 backdrop-blur-md border border-outline-variant">
                <p className="font-label-mono-xs text-[11px] text-primary tracking-widest">
                  {String(chapter + 1).padStart(2, "0")} · {STORY[chapter].title.toUpperCase()}
                </p>
              </div>
            </div>
          )}

          {note && (
            <div className="absolute top-6 right-4 px-3 py-1.5 rounded bg-surface-container-lowest/80 border border-outline-variant font-label-mono-xs text-[10px] text-outline">
              {note}
            </div>
          )}

          <div className="absolute bottom-0 inset-x-0 flex items-end justify-between px-4 pb-4">
            <div className="flex items-center gap-2">
              <button type="button" className={btn} onClick={() => preset("rio")} title="Voo baixo sobre o rio">
                Sob o rio
              </button>
              <button type="button" className={btn} onClick={() => preset("aerea")} title="Vista aérea da região">
                Aérea
              </button>
              <button type="button" className={btn} onClick={() => preset("cidade")} title="Raso sobre a cidade">
                Cidade
              </button>
            </div>
            <div className="flex items-center gap-2">
              {chapter === null ? (
                <button type="button" className={btn} onClick={startFlight} title="Voo narrado pelos capítulos">
                  <span className="material-symbols-outlined text-[16px]">flight_takeoff</span>
                  Voo
                </button>
              ) : (
                <button type="button" className={btn} onClick={stopFlight} title="Pausar voo">
                  <span className="material-symbols-outlined text-[16px]">pause</span>
                  Pausar
                </button>
              )}
              <button type="button" className={btn} onClick={shot} disabled={shooting} title="Exportar frame atual em 4K">
                <span className="material-symbols-outlined text-[16px]">
                  {shooting ? "hourglass_top" : "photo_camera"}
                </span>
                Foto 4K
              </button>
              <button type="button" className={btn} onClick={onExit} title="Voltar ao mapa (Esc)">
                <span className="material-symbols-outlined text-[16px]">close</span>
                Sair
              </button>
            </div>
          </div>

          <p className="absolute bottom-4 right-4 translate-y-8 font-label-mono-xs text-[9px] text-outline/70">
            Terreno: Copernicus GLO-30 · Edifícios: © OpenStreetMap contributors
          </p>
        </>
      )}
    </div>
  );
}

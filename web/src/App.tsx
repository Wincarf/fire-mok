import { useEffect, useRef, useState } from "react";
import * as maplibregl from "maplibre-gl";
import type { Vis } from "./vis";
import { STORY, type Step } from "./story";
import { StoryOverlay } from "./components/StoryOverlay";
import { Header } from "./components/Header";
import { LayersDrawer } from "./components/LayersDrawer";
import { MapHud } from "./components/MapHud";
import { TriagePanel } from "./components/TriagePanel";
import { Timeline } from "./components/Timeline";
import { summarizeMunicipalities, countByCategory } from "./stats";
import { sarSceneDate } from "./format";
import {
  downloadJson,
  fetchMunicipalities,
  fetchPlan,
  floodPolygonsAvailable,
  probeTiler,
  type MuniFC,
  type MuniFeature,
  type Plan,
} from "./api";
import {
  applyVis,
  attachMuniInteractions,
  bindMapData,
  CENTER,
  feedMuni,
  SAR_SCENE_BEFORE,
  selFilter,
  styleFor,
  syncMaps,
} from "./mapStyle";

export default function App() {
  const wrap = useRef<HTMLDivElement>(null);
  const mapRef = useRef<HTMLDivElement>(null);
  const beforeRef = useRef<HTMLDivElement>(null);
  const map = useRef<maplibregl.Map | null>(null);
  const beforeMap = useRef<maplibregl.Map | null>(null);
  const [selCode, setSelCode] = useState<string | null>(null);
  const [munis, setMunis] = useState<MuniFeature[]>([]);
  const [munisFailed, setMunisFailed] = useState(false);
  const [plan, setPlan] = useState<Plan | null>(null);
  const [layers, setLayers] = useState<Vis>({ flood: false, sus: false, muni: true });
  const layersRef = useRef(layers);
  const selCodeRef = useRef(selCode);
  const muniFc = useRef<MuniFC | null>(null); // full FeatureCollection for maplibre sources
  const [compare, setCompare] = useState(false);
  const [split, setSplit] = useState(50);
  const [step, setStep] = useState<number | null>(0);
  const [tiler, setTiler] = useState<"loading" | "online" | "offline">("loading");
  const [tilerMs, setTilerMs] = useState<number | null>(null);
  const [coords, setCoords] = useState<{ lng: number; lat: number } | null>(null);
  const [zoom, setZoom] = useState(9);
  const [floodOk, setFloodOk] = useState(false);

  const sel =
    munis.find((f) => f.properties?.code === selCode)?.properties ?? null;
  const summary = summarizeMunicipalities(munis);
  const counts = countByCategory(munis);

  // leaving story mode lands on the plain risk view
  const exitStory = () => {
    setStep(null);
    setLayers({ flood: false, sus: false, muni: true });
  };

  useEffect(() => {
    const m = new maplibregl.Map({
      container: mapRef.current!,
      // full style up front — starting empty + setStyle on "load" rebuilt the
      // style forever (load refires after each rebuild, discarding sources
      // mid-fetch: choropleth flickered, toggles never stuck)
      style: styleFor(layersRef.current, "risk"),
      center: CENTER,
      zoom: 9,
      attributionControl: false,
    });
    (window as any).__map = m; // dev/e2e hook: inspect style state in tests
    map.current = m;

    // re-apply toggles/data whenever a (re)loaded style finishes — the old
    // effect skipped silently while isStyleLoaded() was false and the flood
    // layer stayed hidden
    bindMapData(m, {
      munis: () => muniFc.current,
      sel: () => selCodeRef.current,
      vis: () => layersRef.current,
    });

    m.on("load", () => attachMuniInteractions(m, setSelCode));

    // live coordinate readout for the header HUD (rAF-throttled)
    let coordRaf = 0;
    m.on("mousemove", (e) => {
      if (coordRaf) return;
      const { lng, lat } = e.lngLat;
      coordRaf = requestAnimationFrame(() => {
        coordRaf = 0;
        setCoords({ lng, lat });
      });
    });
    m.on("zoom", () => setZoom(m.getZoom()));

    fetchMunicipalities()
      .then((d) => {
        setMunis(d.features);
        muniFc.current = d;
        for (const mm of [map.current, beforeMap.current]) if (mm) feedMuni(mm, d);
      })
      .catch(() => setMunisFailed(true));

    return () => {
      cancelAnimationFrame(coordRaf);
      m.remove();
    };
  }, []);

  // compare mode: second map (SAR recession) under the clipped "peak" view
  const comparePrev = useRef(false);
  useEffect(() => {
    const m = map.current;
    if (!m || compare === comparePrev.current) return; // skip the mount pass —
    comparePrev.current = compare; // constructor style already matches "risk"
    m.setStyle(styleFor(layersRef.current, compare ? "after" : "risk"));
    if (!compare || !beforeRef.current) return;
    const m2 = new maplibregl.Map({
      container: beforeRef.current,
      style: styleFor(layersRef.current, "before"),
      center: m.getCenter(),
      zoom: m.getZoom(),
      attributionControl: false,
    });
    (window as any).__map2 = m2; // dev/e2e hook
    m2.on("load", () => attachMuniInteractions(m2, setSelCode));
    bindMapData(m2, {
      munis: () => muniFc.current,
      sel: () => selCodeRef.current,
      vis: () => layersRef.current,
    });
    beforeMap.current = m2;

    const unsync = syncMaps(m, m2);
    return () => {
      unsync();
      m2.remove();
      beforeMap.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [compare]);

  // rio-tiler health probe for the header status pill
  useEffect(() => {
    const t0 = performance.now();
    probeTiler()
      .then(() => {
        setTiler("online");
        setTilerMs(Math.round(performance.now() - t0));
      })
      .catch(() => setTiler("offline"));
  }, []);

  useEffect(() => {
    floodPolygonsAvailable().then(setFloodOk);
  }, []);

  // guided story — each step drives camera, layers, selection
  useEffect(() => {
    if (step === null) return;
    const s: Step = STORY[step];
    const m = map.current;
    if (m) m.flyTo({ center: [s.camera[0], s.camera[1]], zoom: s.camera[2], bearing: 0, pitch: 0 });
    setLayers(s.layers);
    setSelCode(s.sel ?? null);
  }, [step]);

  useEffect(() => {
    if (!sel?.code) {
      setPlan(null);
      return;
    }
    let alive = true;
    fetchPlan(sel.code)
      .then((d) => alive && setPlan(d))
      .catch(() => alive && setPlan(null));
    return () => {
      alive = false;
      setPlan(null);
    };
  }, [sel]);

  // layer toggles (styledata covers the not-yet-loaded case)
  useEffect(() => {
    layersRef.current = layers;
    for (const m of [map.current, beforeMap.current])
      if (m && m.isStyleLoaded()) applyVis(m, layers);
  }, [layers]);

  // keep selCodeRef current so styledata can re-apply the highlight
  useEffect(() => {
    selCodeRef.current = selCode;
  }, [selCode]);

  // highlight the selected municipality outline on every mounted map
  useEffect(() => {
    for (const m of [map.current, beforeMap.current])
      if (m && m.getLayer("muni-sel")) m.setFilter("muni-sel", selFilter(sel?.code ?? null));
  }, [sel]);

  return (
    <div className="h-full bg-surface text-on-surface">
      <Header
        tiler={tiler}
        tilerMs={tilerMs}
        coords={coords}
        onExport={() => downloadJson("/api/municipalities", "municipal_risk_may2024.geojson")}
        onStory={() => setStep(0)}
      />

      <LayersDrawer
        layers={layers}
        onToggle={(k, v) => setLayers((l) => ({ ...l, [k]: v }))}
        summary={summary}
        lastPass={sarSceneDate(SAR_SCENE_BEFORE)}
      />

      <main className="pl-64 pt-16 h-full relative">
        <MapHud
          zoom={zoom}
          onZoom={(d) => (d > 0 ? map.current?.zoomIn() : map.current?.zoomOut())}
          mapRef={mapRef}
          beforeRef={beforeRef}
          containerRef={wrap}
          counts={counts}
          compare={compare}
          onCompare={() => setCompare((c) => !c)}
          split={split}
          onDividerDown={(e) => {
            e.preventDefault();
            const move = (ev: PointerEvent) => {
              const r = wrap.current!.getBoundingClientRect();
              setSplit(Math.min(100, Math.max(0, ((ev.clientX - r.left) / r.width) * 100)));
            };
            const up = () => {
              window.removeEventListener("pointermove", move);
              window.removeEventListener("pointerup", up);
            };
            window.addEventListener("pointermove", move);
            window.addEventListener("pointerup", up);
          }}
        />
        {munisFailed && (
          <div className="absolute top-16 left-1/2 -translate-x-1/2 z-30 px-space-md py-space-sm rounded-lg bg-error-container/90 border border-error/50 backdrop-blur-md flex items-center gap-space-sm">
            <span className="material-symbols-outlined text-[16px] text-error">cloud_off</span>
            <span className="font-label-mono-xs text-label-mono-xs text-on-surface">
              Municipal risk data unavailable — API unreachable
            </span>
          </div>
        )}
        {sel && (
          <TriagePanel
            sel={sel}
            plan={plan}
            floodOk={floodOk}
            onClose={() => setSelCode(null)}
            onExportFlood={() => downloadJson("/api/flood_polygons", "flooded_areas_may2024.geojson")}
          />
        )}
        <Timeline step={step} onChapter={setStep} />
        {step !== null && (
          <StoryOverlay
            index={step}
            total={STORY.length}
            step={STORY[step]}
            onPrev={() => setStep((s) => (s === null || s === 0 ? s : s - 1))}
            onNext={() => setStep((s) => (s === null ? null : s >= STORY.length - 1 ? null : s + 1))}
            onSkip={exitStory}
            onRestart={() => setStep(0)}
          />
        )}
      </main>
    </div>
  );
}

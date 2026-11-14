import { useEffect, useRef, useState, lazy, Suspense } from "react";
import * as maplibregl from "maplibre-gl";
import type { Vis } from "./vis";
import { STORY, type Step } from "./story";
import { StoryOverlay } from "./components/StoryOverlay";
import { Header } from "./components/Header";
import { LayersDrawer } from "./components/LayersDrawer";
import { MapHud } from "./components/MapHud";
import { TriagePanel } from "./components/TriagePanel";
import { Timeline } from "./components/Timeline";
import { summarizeMunicipalities } from "./stats";
import { sarSceneDate } from "./format";

const CinematicMode = lazy(() => import("./components/CinematicMode"));

async function downloadJson(url: string, filename: string) {
  try {
    const r = await fetch(url);
    if (!r.ok) return;
    const blob = await r.blob();
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    a.click();
    URL.revokeObjectURL(a.href);
  } catch {
    /* offline / api down — nothing to export */
  }
}

const CENTER: [number, number] = [-51.15, -30.05];
const GRAY = "rescale=-30,0";
const FLOOD_CMAP = encodeURIComponent(
  JSON.stringify({ 0: [0, 0, 0, 0], 1: [220, 38, 38, 200] })
);
const SUS_CMAP = encodeURIComponent(
  JSON.stringify({ 0: [0, 0, 0, 0], 1: [37, 99, 235, 140] })
);
const RISK_COLOR: Record<string, string> = {
  critical: "#ff817a",
  high: "#f59e0b",
  moderate: "#eab308",
  low: "#10b981",
};

// same filename as LAYERS["sar_before"] in api/app.py — date shown in the drawer
const SAR_SCENE_BEFORE =
  "S1A_IW_GRDH_1SDV_20240604T084924_20240604T084953_054171_069681_rtc_vv_db.tif";

const base: maplibregl.StyleSpecification = {
  version: 8,
  sources: {
    osm: {
      type: "raster",
      tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
      tileSize: 256,
      attribution: "© OpenStreetMap",
    },
    muni: { type: "geojson", data: "/api/municipalities" },
  },
  layers: [
    { id: "osm", type: "raster", source: "osm" },
    {
      id: "muni-fill",
      type: "fill",
      source: "muni",
      paint: {
        "fill-color": [
          "match", ["get", "risk_category"],
          "critical", RISK_COLOR.critical,
          "high", RISK_COLOR.high,
          "moderate", RISK_COLOR.moderate,
          "low", RISK_COLOR.low,
          "#888888",
        ] as any,
        "fill-opacity": 0.32,
      },
    },
    {
      id: "muni-line",
      type: "line",
      source: "muni",
      paint: { "line-color": "#0f172a", "line-width": 1.1 },
    },
    {
      id: "muni-sel",
      type: "line",
      source: "muni",
      filter: ["==", ["get", "code"], "__none__"],
      paint: { "line-color": "#22d3ee", "line-width": 3 },
    } as any,
  ],
};

const show = (on: boolean) => (on ? "visible" : "none");

function styleFor(side: "before" | "after", thresh: number, vis: Vis): maplibregl.StyleSpecification {
  const s = JSON.parse(JSON.stringify(base)) as maplibregl.StyleSpecification;
  const sar = side === "before" ? "sar_before" : "sar_after";
  (s.sources as any).sar = {
    type: "raster",
    tiles: [`/tiles/${sar}/{z}/{x}/{y}.png?${GRAY}`],
    tileSize: 256,
  };
  (s.sources as any).flood = {
    type: "raster",
    tiles: [`/tiles/flood_extent/{z}/{x}/{y}.png?colormap=${FLOOD_CMAP}`],
    tileSize: 256,
  };
  (s.sources as any).sus = {
    type: "raster",
    tiles: [`/tiles/susceptibility/{z}/{x}/{y}.png?colormap=${SUS_CMAP}`],
    tileSize: 256,
  };
  if (side === "after") {
    (s.sources as any).mask = {
      type: "raster",
      tiles: [
        `/tiles/sar_after/{z}/{x}/{y}.png?expression=b1<${thresh}&colormap=${FLOOD_CMAP}`,
      ],
      tileSize: 256,
    };
  }
  s.layers.splice(
    1,
    0,
    { id: "sus", type: "raster", source: "sus", layout: { visibility: show(vis.sus) } } as any,
    { id: "sar", type: "raster", source: "sar" } as any,
    { id: "flood", type: "raster", source: "flood", layout: { visibility: show(vis.flood) } } as any,
  );
  if (side === "after") {
    s.layers.splice(
      4, 0,
      { id: "mask", type: "raster", source: "mask", layout: { visibility: show(vis.mask) } } as any,
    );
  }
  for (const l of s.layers) {
    if (l.id === "muni-fill" || l.id === "muni-line") {
      (l as any).layout = { ...(l as any).layout, visibility: show(vis.muni) };
    }
  }
  return s;
}

type Props = Record<string, any>;

export default function App() {
  const wrap = useRef<HTMLDivElement>(null);
  const beforeRef = useRef<HTMLDivElement>(null);
  const afterRef = useRef<HTMLDivElement>(null);
  const afterMap = useRef<maplibregl.Map | null>(null);
  const maps = useRef<maplibregl.Map[]>([]);
  const [thresh, setThresh] = useState(-17);
  const [selCode, setSelCode] = useState<string | null>(null);
  const [munis, setMunis] = useState<any[]>([]);
  const [plan, setPlan] = useState<any>(null);
  const [layers, setLayers] = useState<Vis>({ flood: true, mask: false, sus: false, muni: true });
  const layersRef = useRef(layers);
  const threshRef = useRef(thresh);
  const selCodeRef = useRef(selCode);
  const [split, setSplit] = useState(50);
  const [step, setStep] = useState<number | null>(0);
  const [dragging, setDragging] = useState(false);
  const [tiler, setTiler] = useState<"loading" | "online" | "offline">("loading");
  const [tilerMs, setTilerMs] = useState<number | null>(null);
  const [coords, setCoords] = useState<{ lng: number; lat: number } | null>(null);
  const [zoom, setZoom] = useState(9);
  const [floodOk, setFloodOk] = useState(false);
  const [cine, setCine] = useState(false);

  const sel: Props | null =
    munis.find((f) => f.properties?.code === selCode)?.properties ?? null;
  const summary = summarizeMunicipalities(munis);

  // leaving story mode lands on a useful dashboard, not a blank SAR view
  const exitStory = () => {
    setStep(null);
    setLayers({ flood: true, mask: false, sus: false, muni: true });
    setSplit(50);
  };

  const applyVis = (m: maplibregl.Map, l: Vis) => {
    // only set when different — styledata refires on setLayoutProperty and
    // would loop forever if we re-set the same value
    const v = (id: string, on: boolean) => {
      const want = show(on);
      if (m.getLayer(id) && m.getLayoutProperty(id, "visibility") !== want)
        m.setLayoutProperty(id, "visibility", want);
    };
    v("flood", l.flood);
    v("sus", l.sus);
    v("mask", l.mask);
    v("muni-fill", l.muni);
    v("muni-line", l.muni);
  };

  useEffect(() => {
    const opts = {
      style: { version: 8, sources: {}, layers: [] } as any,
      center: CENTER,
      zoom: 9,
      attributionControl: false as const,
    };
    const m1 = new maplibregl.Map({ ...opts, container: beforeRef.current! });
    const m2 = new maplibregl.Map({ ...opts, container: afterRef.current! });
    m1.on("load", () => m1.setStyle(styleFor("before", thresh, layers)));
    m2.on("load", () => m2.setStyle(styleFor("after", thresh, layers)));
    afterMap.current = m2;
    maps.current = [m1, m2];

    // re-apply toggles whenever a (re)loaded style finishes — the old effect
    // skipped silently while isStyleLoaded() was false and flood stayed hidden
    const onStyleData = (m: maplibregl.Map) => {
      applyVis(m, layersRef.current);
      if (m.getLayer("muni-sel"))
        m.setFilter("muni-sel", ["==", ["get", "code"], selCodeRef.current ?? "__none__"] as any);
      const src = m.getSource("mask") as any;
      if (src) src.setTiles([`/tiles/sar_after/{z}/{x}/{y}.png?expression=b1<${threshRef.current}&colormap=${FLOOD_CMAP}`]);
    };
    m1.on("styledata", () => onStyleData(m1));
    m2.on("styledata", () => onStyleData(m2));

    // keep both maps in sync (replaces maplibre-gl-compare, which needs node "events")
    let syncing = false;
    const sync = (src: maplibregl.Map, dst: maplibregl.Map) => {
      src.on("move", () => {
        if (syncing) return;
        syncing = true;
        dst.jumpTo({ center: src.getCenter(), zoom: src.getZoom(), bearing: src.getBearing(), pitch: src.getPitch() });
        syncing = false;
      });
    };
    sync(m1, m2);
    sync(m2, m1);

    const click = (e: maplibregl.MapMouseEvent) => {
      const f = e.target.queryRenderedFeatures(e.point, { layers: ["muni-fill"] })[0];
      setSelCode(f ? f.properties.code : null);
    };
    const cursor = (m: maplibregl.Map) => {
      m.on("click", "muni-fill", click);
      m.on("click", (e) => {
        if (!m.queryRenderedFeatures(e.point, { layers: ["muni-fill"] }).length) setSelCode(null);
      });
      m.on("mouseenter", "muni-fill", () => (m.getCanvas().style.cursor = "pointer"));
      m.on("mouseleave", "muni-fill", () => (m.getCanvas().style.cursor = ""));
    };
    m1.on("load", () => cursor(m1));
    m2.on("load", () => cursor(m2));

    // live coordinate readout for the header HUD (rAF-throttled)
    let coordRaf = 0;
    const onHover = (e: maplibregl.MapMouseEvent) => {
      if (coordRaf) return;
      const { lng, lat } = e.lngLat;
      coordRaf = requestAnimationFrame(() => {
        coordRaf = 0;
        setCoords({ lng, lat });
      });
    };
    m1.on("mousemove", onHover);
    m2.on("mousemove", onHover);
    m2.on("zoom", () => setZoom(m2.getZoom()));

    fetch("/api/municipalities")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => d && setMunis(d.features ?? []))
      .catch(() => {});
    return () => {
      cancelAnimationFrame(coordRaf);
      m1.remove();
      m2.remove();
    };
  }, []);

  // rio-tiler health probe for the header status pill
  useEffect(() => {
    const t0 = performance.now();
    fetch("/api/layers")
      .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
      .then(() => {
        setTiler("online");
        setTilerMs(Math.round(performance.now() - t0));
      })
      .catch(() => setTiler("offline"));
  }, []);

  // flood-polygon export is only enabled when the layer was actually built
  useEffect(() => {
    fetch("/api/flood_polygons", { method: "HEAD" })
      .then((r) => setFloodOk(r.ok))
      .catch(() => setFloodOk(false));
  }, []);

  // guided story — each step drives camera, layers, divider, selection
  useEffect(() => {
    if (step === null) return;
    const s: Step = STORY[step];
    const m = afterMap.current;
    if (m) m.flyTo({ center: [s.camera[0], s.camera[1]], zoom: s.camera[2], bearing: 0, pitch: 0 });
    setLayers(s.layers);
    setSplit(s.split);
    setSelCode(s.sel ?? null);
  }, [step]);

  useEffect(() => {
    if (!sel?.code) return setPlan(null);
    let alive = true;
    fetch(`/api/plan/${sel.code}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => alive && setPlan(d))
      .catch(() => {});
    return () => {
      alive = false;
      setPlan(null);
    };
  }, [sel]);

  // threshold -> update the after-mask tiles live (styledata covers the
  // still-loading case via threshRef)
  useEffect(() => {
    threshRef.current = thresh;
    const m = afterMap.current;
    if (!m || !m.getSource("mask")) return;
    (m.getSource("mask") as any).setTiles([
      `/tiles/sar_after/{z}/{x}/{y}.png?expression=b1<${thresh}&colormap=${FLOOD_CMAP}`,
    ]);
  }, [thresh]);

  // layer toggles on both maps (styledata covers the not-yet-loaded case)
  useEffect(() => {
    layersRef.current = layers;
    for (const m of maps.current) if (m.isStyleLoaded()) applyVis(m, layers);
  }, [layers]);

  // keep selCodeRef current so styledata can re-apply the highlight
  useEffect(() => {
    selCodeRef.current = selCode;
  }, [selCode]);

  // highlight the selected municipality outline on both maps
  useEffect(() => {
    for (const m of maps.current) {
      if (m.getLayer("muni-sel"))
        m.setFilter("muni-sel", ["==", ["get", "code"], sel?.code ?? "__none__"] as any);
    }
  }, [sel]);

  return (
    <div className="h-full bg-surface text-on-surface">
      <Header
        tiler={tiler}
        tilerMs={tilerMs}
        coords={coords}
        onExport={() => downloadJson("/api/municipalities", "municipios_risco_may2024.geojson")}
        onStory={() => setStep(0)}
      />

      <LayersDrawer
        layers={layers}
        onToggle={(k, v) => setLayers((l) => ({ ...l, [k]: v }))}
        thresh={thresh}
        onThresh={(v) => {
          setThresh(v);
          setLayers((l) => ({ ...l, mask: true }));
        }}
        summary={summary}
        lastPass={sarSceneDate(SAR_SCENE_BEFORE)}
      />

      <main className="pl-64 pt-16 h-full relative">
        <MapHud
          zoom={zoom}
          onZoom={(d) => (d > 0 ? afterMap.current?.zoomIn() : afterMap.current?.zoomOut())}
          split={split}
          topAnim={step !== null && !dragging}
          beforeRef={beforeRef}
          afterRef={afterRef}
          containerRef={wrap}
          onDividerDown={(e) => {
            e.preventDefault();
            setDragging(true);
            const move = (ev: PointerEvent) => {
              const r = wrap.current!.getBoundingClientRect();
              setSplit(Math.min(100, Math.max(0, ((ev.clientX - r.left) / r.width) * 100)));
            };
            const up = () => {
              setDragging(false);
              window.removeEventListener("pointermove", move);
              window.removeEventListener("pointerup", up);
            };
            window.addEventListener("pointermove", move);
            window.addEventListener("pointerup", up);
          }}
          onCinematic={() => setCine(true)}
        />
        {cine && (
          <Suspense fallback={null}>
            <CinematicMode onExit={() => setCine(false)} />
          </Suspense>
        )}
        {sel && (
          <TriagePanel
            sel={sel}
            plan={plan}
            floodOk={floodOk}
            onClose={() => setSelCode(null)}
            onExportFlood={() => downloadJson("/api/flood_polygons", "areas_alagadas_may2024.geojson")}
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

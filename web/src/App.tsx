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

const show = (on: boolean) => (on ? "visible" : "none");
const GRAY = "rescale=-30,0";

// mode "risk" = basemap + choropleth only; "before"/"after" add the SAR scene
function styleFor(vis: Vis, mode: "risk" | "before" | "after"): maplibregl.StyleSpecification {
  const s: maplibregl.StyleSpecification = {
    version: 8,
    sources: {
      osm: {
        type: "raster",
        tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
        tileSize: 256,
        attribution: "© OpenStreetMap",
      },
      flood: {
        type: "raster",
        tiles: [`/tiles/flood_extent/{z}/{x}/{y}.png?colormap=${FLOOD_CMAP}`],
        tileSize: 256,
      },
      sus: {
        type: "raster",
        tiles: [`/tiles/susceptibility/{z}/{x}/{y}.png?colormap=${SUS_CMAP}`],
        tileSize: 256,
      },
      muni: { type: "geojson", data: "/api/municipalities" },
    },
    layers: [
      { id: "osm", type: "raster", source: "osm" },
      {
        id: "sus",
        type: "raster",
        source: "sus",
        layout: { visibility: show(vis.sus) },
      } as any,
      {
        id: "flood",
        type: "raster",
        source: "flood",
        layout: { visibility: show(vis.flood) },
      } as any,
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
          "fill-opacity": 0.55,
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
  if (mode !== "risk") {
    (s.sources as any).sar = {
      type: "raster",
      tiles: [`/tiles/${mode === "before" ? "sar_before" : "sar_after"}/{z}/{x}/{y}.png?${GRAY}`],
      tileSize: 256,
    };
    // sar sits above osm, below the vector overlays
    s.layers.splice(1, 0, { id: "sar", type: "raster", source: "sar" } as any);
  }
  return s;
}

type Props = Record<string, any>;

export default function App() {
  const wrap = useRef<HTMLDivElement>(null);
  const mapRef = useRef<HTMLDivElement>(null);
  const beforeRef = useRef<HTMLDivElement>(null);
  const map = useRef<maplibregl.Map | null>(null);
  const beforeMap = useRef<maplibregl.Map | null>(null);
  const [selCode, setSelCode] = useState<string | null>(null);
  const [munis, setMunis] = useState<any[]>([]);
  const [plan, setPlan] = useState<any>(null);
  const [layers, setLayers] = useState<Vis>({ flood: false, sus: false, muni: true });
  const layersRef = useRef(layers);
  const selCodeRef = useRef(selCode);
  const [compare, setCompare] = useState(false);
  const [split, setSplit] = useState(50);
  const [step, setStep] = useState<number | null>(0);
  const [tiler, setTiler] = useState<"loading" | "online" | "offline">("loading");
  const [tilerMs, setTilerMs] = useState<number | null>(null);
  const [coords, setCoords] = useState<{ lng: number; lat: number } | null>(null);
  const [zoom, setZoom] = useState(9);
  const [floodOk, setFloodOk] = useState(false);

  const sel: Props | null =
    munis.find((f) => f.properties?.code === selCode)?.properties ?? null;
  const summary = summarizeMunicipalities(munis);
  const counts = countByCategory(munis);

  // leaving story mode lands on the plain risk view
  const exitStory = () => {
    setStep(null);
    setLayers({ flood: false, sus: false, muni: true });
  };

  // shared municipality interactions for both maps
  const attachCursors = (m: maplibregl.Map) => {
    m.on("click", "muni-fill", (e) => {
      const f = e.target.queryRenderedFeatures(e.point, { layers: ["muni-fill"] })[0];
      setSelCode(f ? f.properties.code : null);
    });
    m.on("click", (e) => {
      if (!m.queryRenderedFeatures(e.point, { layers: ["muni-fill"] }).length) setSelCode(null);
    });
    m.on("mouseenter", "muni-fill", () => (m.getCanvas().style.cursor = "pointer"));
    m.on("mouseleave", "muni-fill", () => (m.getCanvas().style.cursor = ""));
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
    v("muni-fill", l.muni);
    v("muni-line", l.muni);
  };

  useEffect(() => {
    const m = new maplibregl.Map({
      container: mapRef.current!,
      style: { version: 8, sources: {}, layers: [] } as any,
      center: CENTER,
      zoom: 9,
      attributionControl: false,
    });
    m.on("load", () => m.setStyle(styleFor(layersRef.current, "risk")));
    map.current = m;

    // re-apply toggles whenever a (re)loaded style finishes — the old effect
    // skipped silently while isStyleLoaded() was false and flood stayed hidden
    m.on("styledata", () => {
      applyVis(m, layersRef.current);
      if (m.getLayer("muni-sel"))
        m.setFilter("muni-sel", ["==", ["get", "code"], selCodeRef.current ?? "__none__"] as any);
    });

    m.on("load", () => attachCursors(m));

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

    fetch("/api/municipalities")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => d && setMunis(d.features ?? []))
      .catch(() => {});
    return () => {
      cancelAnimationFrame(coordRaf);
      m.remove();
    };
  }, []);

  // compare mode: second map (SAR recessão) under the clipped "pico" view
  useEffect(() => {
    const m = map.current;
    if (!m) return;
    m.setStyle(styleFor(layersRef.current, compare ? "after" : "risk"));
    if (!compare || !beforeRef.current) return;
    const m2 = new maplibregl.Map({
      container: beforeRef.current,
      style: { version: 8, sources: {}, layers: [] } as any,
      center: m.getCenter(),
      zoom: m.getZoom(),
      attributionControl: false,
    });
    m2.on("load", () => {
      m2.setStyle(styleFor(layersRef.current, "before"));
      attachCursors(m2);
    });
    m2.on("styledata", () => {
      applyVis(m2, layersRef.current);
      if (m2.getLayer("muni-sel"))
        m2.setFilter("muni-sel", ["==", ["get", "code"], selCodeRef.current ?? "__none__"] as any);
    });
    beforeMap.current = m2;

    // keep both maps in sync (replaces maplibre-gl-compare, which needs node "events")
    let syncing = false;
    const on1 = () => {
      if (syncing) return;
      syncing = true;
      m2.jumpTo({ center: m.getCenter(), zoom: m.getZoom(), bearing: m.getBearing(), pitch: m.getPitch() });
      syncing = false;
    };
    const on2 = () => {
      if (syncing) return;
      syncing = true;
      m.jumpTo({ center: m2.getCenter(), zoom: m2.getZoom(), bearing: m2.getBearing(), pitch: m2.getPitch() });
      syncing = false;
    };
    m.on("move", on1);
    m2.on("move", on2);
    return () => {
      m.off("move", on1);
      m2.remove();
      beforeMap.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [compare]);

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
      if (m && m.getLayer("muni-sel"))
        m.setFilter("muni-sel", ["==", ["get", "code"], sel?.code ?? "__none__"] as any);
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

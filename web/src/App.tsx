import { useEffect, useRef, useState } from "react";
import * as maplibregl from "maplibre-gl";
import type { Vis } from "./vis";
import { STORY, type Step } from "./story";
import { StoryOverlay } from "./components/StoryOverlay";
import { Header } from "./components/Header";
import { ChoreoBar } from "./components/ChoreoBar";
import { LayersDrawer } from "./components/LayersDrawer";
import { MapHud } from "./components/MapHud";
import { MondayCard } from "./components/MondayCard";
import { TriagePanel } from "./components/TriagePanel";
import { Timeline } from "./components/Timeline";
import { summarizeMunicipalities, countByCategory } from "./stats";
import { sarSceneDate } from "./format";

// ABSOLUTE URL that respects the deploy base (GH Pages builds at /fire-mok/).
// MapLibre fetches GeoJSON/vector sources inside a blob-URL worker where
// relative paths don't resolve — every URL handed to a style source must be
// absolute. new URL() would percent-encode the {z}/{x}/{y} tile templates, so
// template URLs are normalized manually (origin + base + template literal).
const withBase = (p: string) => {
  const base = import.meta.env.BASE_URL.replace(/\/$/, "");
  if (p.includes("{")) return `${window.location.origin}${base}${p}`;
  return new URL(`${base}${p}`, window.location.href).href;
};

async function downloadJson(url: string, filename: string) {
  try {
    const r = await fetch(withBase(url));
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
const CHOREO_CMAP = encodeURIComponent(
  JSON.stringify({ 0: [0, 0, 0, 0], 1: [37, 99, 235, 150] })
);
const NISAR_WATER_CMAP = encodeURIComponent(
  JSON.stringify({ 0: [0, 0, 0, 0], 1: [34, 211, 238, 170] })
);
const DIFF_CMAP = encodeURIComponent(
  JSON.stringify({ 0: [0, 0, 0, 0], 1: [220, 38, 38, 160], 2: [34, 211, 238, 190] })
);
const RISK_COLOR: Record<string, string> = {
  critical: "#ef4444", // red-500
  high: "#f97316", // orange-500 — clearly distinct from yellow
  moderate: "#facc15", // yellow-400
  low: "#94a3b8", // slate-400 — neutral wash, 477 munis shouldn't paint the map
};

// same filename as LAYERS["sar_before"] in api/app.py — date shown in the drawer
const SAR_SCENE_BEFORE =
  "S1A_IW_GRDH_1SDV_20240604T084924_20240604T084953_054171_069681_rtc_vv_db.tif";

const show = (on: boolean) => (on ? "visible" : "none");
const GRAY = "rescale=-30,0";

// empty geojson placeholder — real data is pushed via setData() after the
// React fetch lands (MapLibre's worker-side URL fetch is fragile: blob-worker
// scope can't resolve relative URLs, and the request never reaches the API)
const EMPTY_FC = { type: "FeatureCollection", features: [] } as any;
const fedSources = new WeakSet<object>(); // don't setData the same source twice

// mode "risk" = basemap + choropleth only; "before"/"after" add the SAR scene
function styleFor(
  vis: Vis,
  mode: "risk" | "before" | "after" | "nisar"
): maplibregl.StyleSpecification {
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
        tiles: [withBase(`/tiles/flood_extent/{z}/{x}/{y}.png?colormap=${FLOOD_CMAP}`)],
        tileSize: 256,
      },
      sus: {
        type: "raster",
        tiles: [withBase(`/tiles/susceptibility/{z}/{x}/{y}.png?colormap=${SUS_CMAP}`)],
        tileSize: 256,
      },
      "choreo-peak": {
        type: "raster",
        tiles: [withBase(`/tiles/choreo_peak/{z}/{x}/{y}.png?colormap=${CHOREO_CMAP}`)],
        tileSize: 256,
      },
      "choreo-recession": {
        type: "raster",
        tiles: [withBase(`/tiles/choreo_recession/{z}/{x}/{y}.png?colormap=${CHOREO_CMAP}`)],
        tileSize: 256,
      },
      "choreo-calm": {
        type: "raster",
        tiles: [withBase(`/tiles/choreo_calm/{z}/{x}/{y}.png?colormap=${CHOREO_CMAP}`)],
        tileSize: 256,
      },
      muni: { type: "geojson", data: EMPTY_FC },
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
        id: "choreo-peak",
        type: "raster",
        source: "choreo-peak",
        layout: { visibility: "none" },
      } as any,
      {
        id: "choreo-recession",
        type: "raster",
        source: "choreo-recession",
        layout: { visibility: "none" },
      } as any,
      {
        id: "choreo-calm",
        type: "raster",
        source: "choreo-calm",
        layout: { visibility: "none" },
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
          // severity-driven alpha: only critical is painted solid
          "fill-opacity": [
            "match", ["get", "risk_category"],
            "critical", 0.65,
            "high", 0.3,
            "moderate", 0.2,
            "low", 0.08,
            0.08,
          ] as any,
        },
      },
      {
        id: "muni-line",
        type: "line",
        source: "muni",
        paint: {
          "line-color": [
            "match", ["get", "risk_category"],
            "critical", RISK_COLOR.critical,
            "high", RISK_COLOR.high,
            "moderate", RISK_COLOR.moderate,
            "low", "#64748b",
            "#64748b",
          ] as any,
          "line-width": 1.1,
        },
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
  if (mode === "nisar") {
    (s.sources as any)["nisar-hh"] = {
      type: "raster",
      tiles: [withBase(`/tiles/nisar_hh/{z}/{x}/{y}.png?${GRAY}`)],
      tileSize: 256,
    };
    (s.sources as any)["nisar-water"] = {
      type: "raster",
      tiles: [withBase(`/tiles/nisar_lwater/{z}/{x}/{y}.png?colormap=${NISAR_WATER_CMAP}`)],
      tileSize: 256,
    };
    s.layers.splice(
      1,
      0,
      { id: "nisar-hh", type: "raster", source: "nisar-hh" } as any,
      { id: "nisar-water", type: "raster", source: "nisar-water" } as any
    );
  }
  if (mode !== "risk") {
    (s.sources as any).sar = {
      type: "raster",
      tiles: [withBase(`/tiles/${mode === "before" ? "sar_before" : "sar_after"}/{z}/{x}/{y}.png?${GRAY}`)],
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
  const muniFc = useRef<any>(null); // full FeatureCollection for maplibre sources
  const beatRef = useRef<number | null>(null);
  const choreoRef = useRef<any>(null);
  const danceMuted = useRef(false);
  const [compare, setCompare] = useState(false);
  const [duet, setDuet] = useState(false);
  const [nisarReady, setNisarReady] = useState(false);
  const [avail, setAvail] = useState<Set<string>>(new Set());
  const [choreo, setChoreo] = useState<any>(null);
  const [beat, setBeat] = useState<number | null>(null);
  const [playing, setPlaying] = useState(false);
  const [cardBeat, setCardBeat] = useState<number | null>(null);
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
    setBeat(null);
    setPlaying(false);
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

  const applyVis = (m: maplibregl.Map, l: Vis, freezeNisar = false) => {
    // only set when different — styledata refires on setLayoutProperty and
    // would loop forever if we re-set the same value
    const v = (id: string, on: boolean) => {
      const want = show(on);
      if (m.getLayer(id) && m.getLayoutProperty(id, "visibility") !== want)
        m.setLayoutProperty(id, "visibility", want);
    };
    v("flood", l.flood);
    v("sus", l.sus);
    if (!freezeNisar) {
      v("nisar-hh", !!l.nisarHh);
      v("nisar-water", !!l.nisarWater);
      v("nisar-diff", !!l.nisarDiff);
    }
    v("muni-fill", l.muni);
    v("muni-line", l.muni);
  };

  // the dance: exactly one choreo beat visible at a time
  const applyChoreo = (m: maplibregl.Map | null, b: number | null) => {
    if (!m) return;
    const beats: any[] = choreoRef.current?.beats ?? [];
    beats.forEach((_, i) => {
      const id = `choreo-${i}`;
      const want = show(b === i);
      if (m.getLayer(id) && m.getLayoutProperty(id, "visibility") !== want)
        m.setLayoutProperty(id, "visibility", want);
    });
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

    // re-apply toggles whenever a (re)loaded style finishes — the old effect
    // skipped silently while isStyleLoaded() was false and flood stayed hidden
    m.on("styledata", () => {
      applyVis(m, layersRef.current);
      applyChoreo(m, beatRef.current);
      const src = m.getSource("muni") as maplibregl.GeoJSONSource | undefined;
      if (muniFc.current && src && !fedSources.has(src)) {
        src.setData(muniFc.current);
        fedSources.add(src);
      }
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

    fetch(withBase("/api/municipalities"))
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!d) return;
        setMunis(d.features ?? []);
        muniFc.current = d;
        for (const mm of [map.current, beforeMap.current]) {
          const src = mm?.getSource("muni") as maplibregl.GeoJSONSource | undefined;
          if (src && !fedSources.has(src)) {
            src.setData(d);
            fedSources.add(src);
          }
        }
      })
      .catch(() => {});
    fetch(withBase("/api/choreo"))
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!d) return;
        choreoRef.current = d;
        setChoreo(d);
      })
      .catch(() => {});
    return () => {
      cancelAnimationFrame(coordRaf);
      m.remove();
    };
  }, []);

  // split mode: "sar" = recession vs peak; "duet" = Sentinel-1 C vs NISAR L
  type SplitMode = "off" | "sar" | "duet";
  const splitModePrev = useRef<SplitMode>("off");
  const splitMode: SplitMode = compare ? "sar" : duet ? "duet" : "off";
  useEffect(() => {
    const m = map.current;
    if (!m || splitMode === splitModePrev.current) return; // skip the mount pass —
    splitModePrev.current = splitMode; // constructor style already matches "risk"
    m.setStyle(
      styleFor(layersRef.current, splitMode === "off" ? "risk" : "after")
    );
    if (splitMode === "off" || !beforeRef.current) return;
    const m2 = new maplibregl.Map({
      container: beforeRef.current,
      style: styleFor(layersRef.current, splitMode === "sar" ? "before" : "nisar"),
      center: m.getCenter(),
      zoom: m.getZoom(),
      attributionControl: false,
    });
    (window as any).__map2 = m2; // dev/e2e hook
    m2.on("load", () => attachCursors(m2));
    m2.on("styledata", () => {
      // duet right map owns its NISAR visibility (style-defined)
      applyVis(m2, layersRef.current, splitMode === "duet");
      applyChoreo(m2, beatRef.current);
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
  }, [compare, duet]);

  // NISAR layers join both maps only once the product shows up in /api/layers
  useEffect(() => {
    if (!avail.has("nisar_hh")) return;
    for (const m of [map.current, beforeMap.current]) {
      if (!m || m.getSource("nisar-hh")) continue;
      m.addSource("nisar-hh", {
        type: "raster",
        tiles: [withBase(`/tiles/nisar_hh/{z}/{x}/{y}.png?${GRAY}`)],
        tileSize: 256,
      } as any);
      m.addSource("nisar-water", {
        type: "raster",
        tiles: [withBase(`/tiles/nisar_lwater/{z}/{x}/{y}.png?colormap=${NISAR_WATER_CMAP}`)],
        tileSize: 256,
      } as any);
      m.addSource("nisar-diff", {
        type: "raster",
        tiles: [withBase(`/tiles/nisar_diff/{z}/{x}/{y}.png?colormap=${DIFF_CMAP}`)],
        tileSize: 256,
      } as any);
      m.addLayer({ id: "nisar-hh", type: "raster", source: "nisar-hh", layout: { visibility: show(!!layersRef.current.nisarHh) } } as any, "muni-fill");
      m.addLayer({ id: "nisar-water", type: "raster", source: "nisar-water", layout: { visibility: show(!!layersRef.current.nisarWater) } } as any, "muni-fill");
      m.addLayer({ id: "nisar-diff", type: "raster", source: "nisar-diff", layout: { visibility: show(!!layersRef.current.nisarDiff) } } as any, "muni-fill");
    }
    setNisarReady(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [avail, compare, duet]);

  // dance state: mute competing overlays once per dance session
  useEffect(() => {
    beatRef.current = beat;
    if (beat !== null && !danceMuted.current) {
      danceMuted.current = true;
      setLayers((l) => ({ ...l, flood: false, sus: false }));
    }
    if (beat === null) danceMuted.current = false;
    for (const m of [map.current, beforeMap.current])
      if (m && m.isStyleLoaded()) applyChoreo(m, beat);
  }, [beat]);

  // play = loop the three beats
  useEffect(() => {
    if (!playing) return;
    const n = choreoRef.current?.beats?.length ?? 3;
    const t = setInterval(() => setBeat((b) => (b === null ? 0 : (b + 1) % n)), 1400);
    return () => clearInterval(t);
  }, [playing]);

  // rio-tiler health probe for the header status pill
  useEffect(() => {
    const t0 = performance.now();
    fetch(withBase("/api/layers"))
      .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
      .then((d) => {
        setTiler("online");
        setTilerMs(Math.round(performance.now() - t0));
        setAvail(
          new Set(
            (d?.layers ?? []).filter((e: any) => e.available).map((e: any) => e.id)
          )
        );
      })
      .catch(() => setTiler("offline"));
  }, []);

  // flood-polygon export is only enabled when the layer was actually built
  useEffect(() => {
    fetch(withBase("/api/flood_polygons"), { method: "HEAD" })
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
    fetch(withBase(`/api/plan/${sel.code}`))
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
        onExport={() => downloadJson("/api/municipalities", "municipal_risk_may2024.geojson")}
        onStory={() => {
          setBeat(null);
          setPlaying(false);
          setStep(0);
        }}
      />

      <LayersDrawer
        layers={layers}
        onToggle={(k, v) => setLayers((l) => ({ ...l, [k]: v }))}
        summary={summary}
        lastPass={sarSceneDate(SAR_SCENE_BEFORE)}
        nisarReady={nisarReady}
      />

      <main className="pl-64 pt-16 h-full relative">
        <MapHud
          zoom={zoom}
          onZoom={(d) => (d > 0 ? map.current?.zoomIn() : map.current?.zoomOut())}
          mapRef={mapRef}
          beforeRef={beforeRef}
          containerRef={wrap}
          counts={counts}
          compare={compare || duet}
          onCompare={() => {
            setCompare((c) => !c);
            setDuet(false);
          }}
          showDuet={nisarReady}
          duet={duet}
          onDuet={() => {
            setDuet((d) => !d);
            setCompare(false);
          }}
          splitLabels={
            duet
              ? { left: "SENTINEL-1 C-BAND · 11/MAY/24", right: "NISAR L-BAND · OPEN WATER" }
              : undefined
          }
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
            onExportFlood={() => downloadJson("/api/flood_polygons", "flooded_areas_may2024.geojson")}
          />
        )}
        {step !== null && <Timeline step={step} onChapter={setStep} />}
        {step === null && choreo && (
          <ChoreoBar
            beats={choreo.beats}
            beat={beat}
            playing={playing}
            onBeat={(i) => setBeat(i === beat ? null : i)}
            onPlay={() => setPlaying((p) => !p)}
            onCard={(i) => setCardBeat(i)}
          />
        )}
        {cardBeat !== null && choreo && (
          <MondayCard beatData={choreo.beats[cardBeat]} onClose={() => setCardBeat(null)} />
        )}
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

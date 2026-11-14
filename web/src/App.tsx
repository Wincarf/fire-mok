import { useEffect, useRef, useState } from "react";
import maplibregl from "maplibre-gl";

const CENTER: [number, number] = [-51.15, -30.05];
const GRAY = "rescale=-30,0";
const FLOOD_CMAP = encodeURIComponent(
  JSON.stringify({ 0: [0, 0, 0, 0], 1: [220, 38, 38, 200] })
);
const SUS_CMAP = encodeURIComponent(
  JSON.stringify({ 0: [0, 0, 0, 0], 1: [37, 99, 235, 140] })
);
const RISK_COLOR: Record<string, string> = {
  critical: "#b91c1c",
  high: "#ea580c",
  moderate: "#eab308",
  low: "#22c55e",
};

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

type Vis = { flood: boolean; mask: boolean; sus: boolean; muni: boolean };
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
  const [sel, setSel] = useState<Props | null>(null);
  const [plan, setPlan] = useState<any>(null);
  const [layers, setLayers] = useState<Vis>({ flood: true, mask: false, sus: false, muni: true });
  const layersRef = useRef(layers);
  const [split, setSplit] = useState(50);

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
    m1.on("styledata", () => applyVis(m1, layersRef.current));
    m2.on("styledata", () => applyVis(m2, layersRef.current));

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
      setSel(f ? f.properties : null);
    };
    const cursor = (m: maplibregl.Map) => {
      m.on("click", "muni-fill", click);
      m.on("click", (e) => {
        if (!m.queryRenderedFeatures(e.point, { layers: ["muni-fill"] }).length) setSel(null);
      });
      m.on("mouseenter", "muni-fill", () => (m.getCanvas().style.cursor = "pointer"));
      m.on("mouseleave", "muni-fill", () => (m.getCanvas().style.cursor = ""));
    };
    m1.on("load", () => cursor(m1));
    m2.on("load", () => cursor(m2));
    return () => { m1.remove(); m2.remove(); };
  }, []);

  useEffect(() => {
    if (!sel?.code) return setPlan(null);
    fetch(`/api/plan/${sel.code}`).then((r) => (r.ok ? r.json() : null)).then(setPlan);
  }, [sel]);

  // threshold -> update the after-mask tiles live
  useEffect(() => {
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

  // highlight the selected municipality outline on both maps
  useEffect(() => {
    for (const m of maps.current) {
      if (m.getLayer("muni-sel"))
        m.setFilter("muni-sel", ["==", ["get", "code"], sel?.code ?? "__none__"] as any);
    }
  }, [sel]);

  return (
    <div className="app">
      <header>
        <h1>Fire Mok</h1>
        <span>Enchente Guaíba — mai/2024 · Sentinel-1 RTC (σ0 VV) · antes: 04/jun vs pico: 11/mai</span>
      </header>

      <div className="toolbar">
        <label>
          <input type="checkbox" checked={layers.flood} onChange={(e) => setLayers({ ...layers, flood: e.target.checked })} />
          Extensão da enchente
        </label>
        <label>
          <input type="checkbox" checked={layers.mask} onChange={(e) => setLayers({ ...layers, mask: e.target.checked })} />
          Máscara de água (σ0)
        </label>
        <label>
          <input type="checkbox" checked={layers.sus} onChange={(e) => setLayers({ ...layers, sus: e.target.checked })} />
          Terreno suscetível
        </label>
        <label>
          <input type="checkbox" checked={layers.muni} onChange={(e) => setLayers({ ...layers, muni: e.target.checked })} />
          Municípios / risco
        </label>
        <label className="slider">
          Limiar σ0: {thresh} dB
          <input type="range" min={-25} max={-10} step={0.5} value={thresh}
            onChange={(e) => { setThresh(Number(e.target.value)); setLayers((l) => ({ ...l, mask: true })); }} />
        </label>
        <span className="legend">
          Risco: <i style={{ background: RISK_COLOR.critical }} />crítico
          <i style={{ background: RISK_COLOR.high }} />alto
          <i style={{ background: RISK_COLOR.moderate }} />moderado
          <i style={{ background: RISK_COLOR.low }} />baixo
        </span>
        <span className="hint">Clique num município para ver exposição e plano de ação</span>
      </div>

      <div ref={wrap} className="compare">
        <div ref={beforeRef} className="map" />
        <div ref={afterRef} className="map top" style={{ clipPath: `inset(0 0 0 ${split}%)` }} />
        <div
          className="divider"
          style={{ left: `${split}%` }}
          onMouseDown={(e) => {
            e.preventDefault();
            const move = (ev: MouseEvent) => {
              const r = wrap.current!.getBoundingClientRect();
              setSplit(Math.min(100, Math.max(0, ((ev.clientX - r.left) / r.width) * 100)));
            };
            const up = () => { window.removeEventListener("mousemove", move); window.removeEventListener("mouseup", up); };
            window.addEventListener("mousemove", move);
            window.addEventListener("mouseup", up);
          }}
        />
        <span className="tag left">BASE SECA · 04/jun (recessão)</span>
        <span className="tag right">PICO · 11/mai (cheia)</span>
      </div>

      {sel && (
        <aside className="panel">
          <button className="close" onClick={() => setSel(null)}>×</button>
          <h2>{sel.name}</h2>
          <p className={`badge ${sel.risk_category}`}>
            Risco {sel.risk_category} · {Number(sel.risk).toFixed(2)}
          </p>
          <ul className="stats">
            <li>População: {Number(sel.population).toLocaleString("pt-BR")}</li>
            <li>Área alagada: {(100 * sel.flood_frac).toFixed(1)}%</li>
            <li>Expostos (estimativa): {Number(sel.pop_exposed).toLocaleString("pt-BR")}</li>
            <li>Chuva máx. 7d: {Number(sel.precip_max7d_mm).toFixed(0)} mm</li>
            <li>Solo saturado: {(100 * (sel.soil_moisture_mean ?? 0)).toFixed(0)}%</li>
          </ul>
          {plan && (
            <>
              <h3>Plano de ação ({plan.priority})</h3>
              <ul className="reasons">{plan.reasons.map((r: string, i: number) => <li key={i}>{r}</li>)}</ul>
              <ol className="actions">{plan.actions.map((a: string, i: number) => <li key={i}>{a}</li>)}</ol>
            </>
          )}
        </aside>
      )}
    </div>
  );
}

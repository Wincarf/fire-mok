import { useEffect, useRef, useState } from "react";
import maplibregl from "maplibre-gl";
import Compare from "@maplibre/maplibre-gl-compare";
import "@maplibre/maplibre-gl-compare/dist/maplibre-gl-compare.css";

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
        "fill-opacity": 0.25,
      },
    },
    {
      id: "muni-line",
      type: "line",
      source: "muni",
      paint: { "line-color": "#334155", "line-width": 0.8 },
    },
  ],
};

function styleFor(side: "before" | "after", thresh: number): maplibregl.StyleSpecification {
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
    { id: "sus", type: "raster", source: "sus", layout: { visibility: "none" } } as any,
    { id: "sar", type: "raster", source: "sar" } as any,
    { id: "flood", type: "raster", source: "flood", layout: { visibility: "none" } } as any,
  );
  if (side === "after") {
    s.layers.splice(
      4, 0,
      { id: "mask", type: "raster", source: "mask", layout: { visibility: "none" } } as any,
    );
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
  const [layers, setLayers] = useState({ flood: true, mask: false, sus: false, muni: true });

  useEffect(() => {
    const opts = {
      style: { version: 8, sources: {}, layers: [] } as any,
      center: CENTER,
      zoom: 9,
      attributionControl: false as const,
    };
    const m1 = new maplibregl.Map({ ...opts, container: beforeRef.current! });
    const m2 = new maplibregl.Map({ ...opts, container: afterRef.current! });
    m1.on("load", () => m1.setStyle(styleFor("before", thresh)));
    m2.on("load", () => m2.setStyle(styleFor("after", thresh)));
    afterMap.current = m2;
    maps.current = [m1, m2];
    new Compare(m1, m2, wrap.current!, {});

    const click = (e: maplibregl.MapMouseEvent) => {
      const f = e.target.queryRenderedFeatures(e.point, { layers: ["muni-fill"] })[0];
      setSel(f ? f.properties : null);
    };
    const cursor = (m: maplibregl.Map) => {
      m.on("click", "muni-fill", click);
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

  // layer toggles on both maps
  useEffect(() => {
    for (const m of maps.current) {
      if (!m.isStyleLoaded()) continue;
      const v = (id: string, on: boolean) =>
        m.getLayer(id) && m.setLayoutProperty(id, "visibility", on ? "visible" : "none");
      v("flood", layers.flood);
      v("sus", layers.sus);
      v("mask", layers.mask);
      v("muni-fill", layers.muni);
      v("muni-line", layers.muni);
    }
  }, [layers, sel]);

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
      </div>

      <div ref={wrap} className="compare">
        <div ref={beforeRef} className="map" />
        <div ref={afterRef} className="map" />
        <span className="tag left">ANTES · 04/jun</span>
        <span className="tag right">DEPOIS · 11/mai</span>
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

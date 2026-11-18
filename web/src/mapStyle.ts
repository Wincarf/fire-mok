// MapLibre bridge: style construction + shared event plumbing. The styledata
// handler is a single function used by both the main and the compare map —
// the previous hand-copied version for the compare map silently dropped the
// municipality feed, leaving the "before" map without the choropleth.
import type {
  ExpressionSpecification,
  FilterSpecification,
  GeoJSONSource,
  Map as MapLibreMap,
  StyleSpecification,
} from "maplibre-gl";
import { withBase, type MuniFC } from "./api";
import { RISK_COLOR, type RiskCategory } from "./risk";
import type { Vis } from "./vis";

export const CENTER: [number, number] = [-51.15, -30.05];

// same scene as api/layers.json["sar_before"].path — date shown in the drawer
export const SAR_SCENE_BEFORE =
  "S1A_IW_GRDH_1SDV_20240604T084924_20240604T084953_054171_069681_rtc_vv_db.tif";

const FLOOD_CMAP = encodeURIComponent(
  JSON.stringify({ 0: [0, 0, 0, 0], 1: [220, 38, 38, 200] })
);
const SUS_CMAP = encodeURIComponent(
  JSON.stringify({ 0: [0, 0, 0, 0], 1: [37, 99, 235, 140] })
);
const GRAY = "rescale=-30,0";
const show = (on: boolean): "visible" | "none" => (on ? "visible" : "none");

const categoryMatch = <T,>(values: Record<RiskCategory, T>, fallback: T) =>
  [
    "match",
    ["get", "risk_category"],
    "critical", values.critical,
    "high", values.high,
    "moderate", values.moderate,
    "low", values.low,
    fallback,
  ] as unknown as ExpressionSpecification;

export const selFilter = (code: string | null): FilterSpecification =>
  ["==", ["get", "code"], code ?? "__none__"] as unknown as FilterSpecification;

// empty geojson placeholder — real data is pushed via setData() after the
// React fetch lands (MapLibre's worker-side URL fetch is fragile: blob-worker
// scope can't resolve relative URLs, and the request never reaches the API)
const EMPTY_FC: GeoJSON.FeatureCollection = { type: "FeatureCollection", features: [] };
const fedSources = new WeakSet<object>(); // don't setData the same source twice

/** push the municipality FC into the map's "muni" source (once per source
 * instance — setStyle recreates sources, which clears the WeakSet entry) */
export function feedMuni(m: MapLibreMap, fc: MuniFC | null) {
  if (!fc) return;
  const src = m.getSource("muni") as GeoJSONSource | undefined;
  if (src && !fedSources.has(src)) {
    src.setData(fc);
    fedSources.add(src);
  }
}

export function applyVis(m: MapLibreMap, l: Vis) {
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
}

// mode "risk" = basemap + choropleth only; "before"/"after" add the SAR scene
export function styleFor(vis: Vis, mode: "risk" | "before" | "after"): StyleSpecification {
  const s: StyleSpecification = {
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
      muni: { type: "geojson", data: EMPTY_FC },
    },
    layers: [
      { id: "osm", type: "raster", source: "osm" },
      {
        id: "sus",
        type: "raster",
        source: "sus",
        layout: { visibility: show(vis.sus) },
      },
      {
        id: "flood",
        type: "raster",
        source: "flood",
        layout: { visibility: show(vis.flood) },
      },
      {
        id: "muni-fill",
        type: "fill",
        source: "muni",
        paint: {
          "fill-color": categoryMatch(RISK_COLOR, "#888888"),
          // severity-driven alpha: only critical is painted solid
          "fill-opacity": categoryMatch(
            { critical: 0.65, high: 0.3, moderate: 0.2, low: 0.08 },
            0.08
          ),
        },
      },
      {
        id: "muni-line",
        type: "line",
        source: "muni",
        paint: {
          "line-color": categoryMatch({ ...RISK_COLOR, low: "#64748b" }, "#64748b"),
          "line-width": 1.1,
        },
      },
      {
        id: "muni-sel",
        type: "line",
        source: "muni",
        filter: selFilter(null),
        paint: { "line-color": "#22d3ee", "line-width": 3 },
      },
    ],
  };
  if (mode !== "risk") {
    s.sources.sar = {
      type: "raster",
      tiles: [
        withBase(
          `/tiles/${mode === "before" ? "sar_before" : "sar_after"}/{z}/{x}/{y}.png?${GRAY}`
        ),
      ],
      tileSize: 256,
    };
    // sar sits above osm, below the vector overlays
    s.layers.splice(1, 0, { id: "sar", type: "raster", source: "sar" });
  }
  return s;
}

/** municipality click/hover interactions, shared by both maps */
export function attachMuniInteractions(
  m: MapLibreMap,
  onSelect: (code: string | null) => void
) {
  m.on("click", "muni-fill", (e) => {
    const f = e.target.queryRenderedFeatures(e.point, { layers: ["muni-fill"] })[0];
    onSelect(f ? String(f.properties.code) : null);
  });
  m.on("click", (e) => {
    if (!m.queryRenderedFeatures(e.point, { layers: ["muni-fill"] }).length) onSelect(null);
  });
  m.on("mouseenter", "muni-fill", () => (m.getCanvas().style.cursor = "pointer"));
  m.on("mouseleave", "muni-fill", () => (m.getCanvas().style.cursor = ""));
}

/** styledata handler shared by main + compare maps: re-apply layer
 * visibility, re-feed the municipality FC (sources die on setStyle), and
 * re-apply the selection highlight. Register once per map. */
export function bindMapData(
  m: MapLibreMap,
  data: { munis: () => MuniFC | null; sel: () => string | null; vis: () => Vis }
) {
  m.on("styledata", () => {
    applyVis(m, data.vis());
    feedMuni(m, data.munis());
    if (m.getLayer("muni-sel")) m.setFilter("muni-sel", selFilter(data.sel()));
  });
}

/** two-way camera sync — returns an unbind function. Replaces
 * maplibre-gl-compare, which needs node "events". */
export function syncMaps(a: MapLibreMap, b: MapLibreMap): () => void {
  let syncing = false;
  const follow = (src: MapLibreMap, dst: MapLibreMap) => () => {
    if (syncing) return;
    syncing = true;
    dst.jumpTo({
      center: src.getCenter(),
      zoom: src.getZoom(),
      bearing: src.getBearing(),
      pitch: src.getPitch(),
    });
    syncing = false;
  };
  const onA = follow(a, b);
  const onB = follow(b, a);
  a.on("move", onA);
  b.on("move", onB);
  return () => {
    a.off("move", onA);
    b.off("move", onB);
  };
}

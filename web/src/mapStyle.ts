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

// same scenes as api/layers.json["sar_before"|"sar_after"].path — dates shown
// in the drawer, compare-mode chips, and timeline
export const SAR_SCENE_BEFORE =
  "S1A_IW_GRDH_1SDV_20240604T084924_20240604T084953_054171_069681_rtc_vv_db.tif";
export const SAR_SCENE_AFTER =
  "S1A_IW_GRDH_1SDV_20240511T084943_20240511T085008_053821_068A6E_rtc_vv_db.tif";

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

export function applyVis(m: MapLibreMap, l: Vis, freezeNisar = false) {
  // only set when different — styledata refires on setLayoutProperty and
  // would loop forever if we re-set the same value
  const v = (id: string, on: boolean) => {
    const want = show(on);
    if (m.getLayer(id) && m.getLayoutProperty(id, "visibility") !== want)
      m.setLayoutProperty(id, "visibility", want);
  };
  v("flood", l.flood);
  v("sus", l.sus);
  if (!freezeNisar) { // duet right map owns its NISAR visibility (style-defined)
    v("nisar-hh", !!l.nisarHh);
    v("nisar-water", !!l.nisarWater);
    v("nisar-diff", !!l.nisarDiff);
  }
  v("muni-fill", l.muni);
  v("muni-line", l.muni);
}

/** the dance: exactly one choreo beat layer visible at a time. Layer ids are
 * choreo-<beat.label> (peak/recession/calm) — indexed ids would never match. */
export function applyChoreo(
  m: MapLibreMap | null,
  b: number | null,
  beats: readonly { label: string }[]
) {
  if (!m) return;
  beats.forEach((beat, i) => {
    const id = `choreo-${beat.label}`;
    const want = show(b === i);
    if (m.getLayer(id) && m.getLayoutProperty(id, "visibility") !== want)
      m.setLayoutProperty(id, "visibility", want);
  });
}

/** NISAR sources+layers are added imperatively once /api/layers reports the
 * product built (styleFor can't know availability at construction time). */
export function addNisarLayers(m: MapLibreMap, l: Vis): boolean {
  if (m.getSource("nisar-hh")) return false;
  const raster = (tiles: string[]) => ({ type: "raster", tiles, tileSize: 256 }) as const;
  m.addSource("nisar-hh", raster([withBase(`/tiles/nisar_hh/{z}/{x}/{y}.png?${GRAY}`)]));
  m.addSource("nisar-water", raster([withBase(`/tiles/nisar_lwater/{z}/{x}/{y}.png?colormap=${NISAR_WATER_CMAP}`)]));
  m.addSource("nisar-diff", raster([withBase(`/tiles/nisar_diff/{z}/{x}/{y}.png?colormap=${DIFF_CMAP}`)]));
  const before = "muni-fill";
  m.addLayer({ id: "nisar-hh", type: "raster", source: "nisar-hh", layout: { visibility: show(!!l.nisarHh) } } as never, before);
  m.addLayer({ id: "nisar-water", type: "raster", source: "nisar-water", layout: { visibility: show(!!l.nisarWater) } } as never, before);
  m.addLayer({ id: "nisar-diff", type: "raster", source: "nisar-diff", layout: { visibility: show(!!l.nisarDiff) } } as never, before);
  return true;
}

// mode "risk" = basemap + choropleth only; "before"/"after" add the SAR scene;
// "nisar" (duet right pane) adds the NISAR L-band scene + open-water proxy
export function styleFor(vis: Vis, mode: "risk" | "before" | "after" | "nisar"): StyleSpecification {
  const choreoSrc = (layer: string) => ({
    type: "raster" as const,
    tiles: [withBase(`/tiles/${layer}/{z}/{x}/{y}.png?colormap=${CHOREO_CMAP}`)],
    tileSize: 256,
  });
  const choreoLayer = (id: string) =>
    ({ id, type: "raster", source: id, layout: { visibility: "none" } }) as const;
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
      "choreo-peak": choreoSrc("choreo_peak"),
      "choreo-recession": choreoSrc("choreo_recession"),
      "choreo-calm": choreoSrc("choreo_calm"),
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
      choreoLayer("choreo-peak"),
      choreoLayer("choreo-recession"),
      choreoLayer("choreo-calm"),
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
  if (mode === "nisar") {
    s.sources["nisar-hh"] = {
      type: "raster",
      tiles: [withBase(`/tiles/nisar_hh/{z}/{x}/{y}.png?${GRAY}`)],
      tileSize: 256,
    };
    s.sources["nisar-water"] = {
      type: "raster",
      tiles: [withBase(`/tiles/nisar_lwater/{z}/{x}/{y}.png?colormap=${NISAR_WATER_CMAP}`)],
      tileSize: 256,
    };
    s.layers.splice(
      1,
      0,
      { id: "nisar-hh", type: "raster", source: "nisar-hh" },
      { id: "nisar-water", type: "raster", source: "nisar-water" }
    );
  }
  if (mode !== "risk" && mode !== "nisar") {
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
  data: {
    munis: () => MuniFC | null;
    sel: () => string | null;
    vis: () => Vis;
    choreo?: () => { beat: number | null; beats: readonly { label: string }[] };
    freezeNisar?: boolean;
  }
) {
  m.on("styledata", () => {
    applyVis(m, data.vis(), data.freezeNisar);
    const c = data.choreo?.();
    if (c) applyChoreo(m, c.beat, c.beats);
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

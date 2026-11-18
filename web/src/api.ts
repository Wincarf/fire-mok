// Typed boundary for the FastAPI backend — field names mirror
// pipeline/types.py (MuniFeatures) and api/app.py responses.
import type { RiskCategory } from "./risk";
// Contract: fetchX throws on failure (HTTP or malformed payload); probeX
// swallows and returns boolean. Plan fetches validate shape like municipalities.

export interface MuniProps {
  code: string;
  name: string;
  risk: number;
  risk_category?: string; // narrowed to RiskCategory by isRiskCategory at consumption
  flood_frac: number;
  sus_frac: number;
  pop_exposed: number;
  population: number;
  precip_max7d_mm: number;
  soil_moisture_mean: number;
  [k: string]: unknown;
}

export type MuniFeature = GeoJSON.Feature<GeoJSON.Geometry, MuniProps>;
export type MuniFC = GeoJSON.FeatureCollection<GeoJSON.Geometry, MuniProps>;

export interface Plan {
  priority: string;
  reasons: string[];
  actions: string[];
}

// ABSOLUTE URL that respects the deploy base (GH Pages builds at /fire-mok/).
// MapLibre fetches GeoJSON/vector sources inside a blob-URL worker where
// relative paths don't resolve — every URL handed to a style source must be
// absolute. new URL() would percent-encode the {z}/{x}/{y} tile templates, so
// template URLs are normalized manually (origin + base + template literal).
export const withBase = (p: string) => {
  const base = import.meta.env.BASE_URL.replace(/\/$/, "");
  if (p.includes("{")) return `${window.location.origin}${base}${p}`;
  return new URL(`${base}${p}`, window.location.href).href;
};

async function getJson<T>(path: string, init?: RequestInit): Promise<T> {
  const r = await fetch(withBase(path), init);
  if (!r.ok) throw new Error(`${path}: HTTP ${r.status}`);
  return (await r.json()) as T;
}

export const fetchMunicipalities = async (): Promise<MuniFC> => {
  const d = await getJson<unknown>("/api/municipalities");
  // unguarded .features deref / setData on a non-FC payload would crash the map
  if (!d || typeof d !== "object" || !Array.isArray((d as MuniFC).features)) {
    console.warn("/api/municipalities: unexpected payload shape", d);
    throw new Error("/api/municipalities: unexpected payload shape");
  }
  return d as MuniFC;
};

const isPlan = (d: unknown): d is Plan =>
  !!d &&
  typeof d === "object" &&
  typeof (d as Plan).priority === "string" &&
  Array.isArray((d as Plan).reasons) &&
  Array.isArray((d as Plan).actions);

export const fetchPlan = async (code: string): Promise<Plan> => {
  const d = await getJson<unknown>(`/api/plan/${encodeURIComponent(code)}`);
  // unguarded .map on a malformed payload would crash the triage panel
  if (!isPlan(d)) {
    console.warn(`/api/plan/${code}: unexpected payload shape`, d);
    throw new Error(`/api/plan/${code}: unexpected payload shape`);
  }
  return d;
};

// rio-tiler health probe for the header status pill
export const probeTiler = async (): Promise<boolean> => {
  try {
    await getJson("/api/layers");
    return true;
  } catch (err) {
    console.warn("tiler probe failed:", err);
    return false;
  }
};

// flood-polygon export is only enabled when the layer was actually built
export const floodPolygonsAvailable = async (): Promise<boolean> => {
  try {
    const r = await fetch(withBase("/api/flood_polygons"), { method: "HEAD" });
    return r.ok;
  } catch (err) {
    console.warn("flood_polygons probe failed:", err);
    return false;
  }
};

export async function downloadJson(path: string, filename: string) {
  try {
    const r = await fetch(withBase(path));
    if (!r.ok) {
      console.warn(`export ${filename}: HTTP ${r.status}`);
      return;
    }
    const blob = await r.blob();
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    a.click();
    URL.revokeObjectURL(a.href);
  } catch (err) {
    console.warn(`export ${filename} failed:`, err);
  }
}

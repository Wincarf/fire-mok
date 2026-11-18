// Typed boundary for the FastAPI backend — field names mirror
// pipeline/types.py (MuniFeatures) and api/app.py responses.
import type { RiskCategory } from "./risk";

export interface MuniProps {
  code: string;
  name: string;
  risk: number;
  risk_category: RiskCategory;
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

export const fetchMunicipalities = () => getJson<MuniFC>("/api/municipalities");

export const fetchPlan = (code: string) =>
  getJson<Plan>(`/api/plan/${encodeURIComponent(code)}`);

// rio-tiler health probe for the header status pill
export const probeTiler = async (): Promise<void> => {
  await getJson("/api/layers");
};

// flood-polygon export is only enabled when the layer was actually built
export const floodPolygonsAvailable = async (): Promise<boolean> => {
  try {
    const r = await fetch(withBase("/api/flood_polygons"), { method: "HEAD" });
    return r.ok;
  } catch {
    return false;
  }
};

export async function downloadJson(url: string, filename: string) {
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

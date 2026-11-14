// OSM buildings via Overpass — runtime fetch, degrades to empty on failure.
import type * as THREE from "three";
import { lngLatToXZ } from "./geo";

type Three = typeof import("three");

export type Building = { cx: number; cz: number; w: number; d: number; h: number };

const MAX_BUILDINGS = 15000;
const OVERPASS = "https://overpass-api.de/api/interpreter";

type OverpassEl = {
  type: string;
  tags?: Record<string, string>;
  geometry?: { lon: number; lat: number }[];
};

const mPerDegLng = (lat: number) => 111320 * Math.cos((lat * Math.PI) / 180);
const mPerDegLat = () => 110540;

export async function fetchBuildings(
  bbox: [number, number, number, number],
  origin: { lng: number; lat: number },
  timeoutMs = 15000
): Promise<Building[]> {
  const [w, s, e, n] = bbox;
  const query = `[out:json][timeout:${Math.ceil(timeoutMs / 1000)}];way["building"](${s},${w},${n},${e});out geom;`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(OVERPASS, {
      method: "POST",
      body: `data=${encodeURIComponent(query)}`,
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      signal: ctrl.signal,
    });
    if (!res.ok) return [];
    const { elements = [] } = (await res.json()) as { elements?: OverpassEl[] };
    const out: Building[] = [];
    for (const el of elements) {
      if (el.type !== "way" || !el.geometry?.length) continue;
      let minLon = Infinity, maxLon = -Infinity, minLat = Infinity, maxLat = -Infinity;
      for (const g of el.geometry) {
        if (g.lon < minLon) minLon = g.lon;
        if (g.lon > maxLon) maxLon = g.lon;
        if (g.lat < minLat) minLat = g.lat;
        if (g.lat > maxLat) maxLat = g.lat;
      }
      const midLat = (minLat + maxLat) / 2;
      const midLng = (minLon + maxLon) / 2;
      const [cx, cz] = lngLatToXZ(midLng, midLat, origin);
      const tags = el.tags ?? {};
      const h =
        parseFloat(tags.height ?? "") ||
        (parseFloat(tags["building:levels"] ?? "") || 0) * 3 ||
        10;
      out.push({
        cx,
        cz,
        w: Math.max(4, (maxLon - minLon) * mPerDegLng(midLat)),
        d: Math.max(4, (maxLat - minLat) * mPerDegLat()),
        h: Math.min(300, h),
      });
    }
    if (out.length > MAX_BUILDINGS) {
      const step = out.length / MAX_BUILDINGS;
      return out.filter((_, i) => i % step < 1).slice(0, MAX_BUILDINGS);
    }
    return out;
  } catch {
    return [];
  } finally {
    clearTimeout(timer);
  }
}

export function buildBuildingsMesh(
  T: Three,
  buildings: Building[],
  emissiveWindows = true
): THREE.InstancedMesh {
  const geo = new T.BoxGeometry(1, 1, 1);
  geo.translate(0, 0.5, 0); // base at y=0, scale h lifts the top
  const mat = new T.MeshStandardMaterial({
    color: "#2a3140",
    roughness: 0.85,
    metalness: 0.1,
    emissive: emissiveWindows ? new T.Color("#ffb36b") : new T.Color("#000"),
    emissiveIntensity: emissiveWindows ? 0.12 : 0,
  });
  const mesh = new T.InstancedMesh(geo, mat, buildings.length);
  const m = new T.Matrix4();
  const rng = seeded(7);
  buildings.forEach((b, i) => {
    const h = b.h * (0.85 + rng() * 0.3); // slight height jitter reads better instanced
    m.makeScale(b.w, h, b.d).setPosition(b.cx, 0, b.cz);
    mesh.setMatrixAt(i, m);
  });
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

function seeded(seed: number) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 0xffffffff);
}

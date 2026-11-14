// Municipality risk prisms — /api/municipalities -> extruded footprints.
// Height = real `risk` (0..1), color = yellow->red ramp.
import type * as THREE from "three";
import { lngLatToXZ, type Origin } from "./geo";

type Three = typeof import("three");

export type RiskShape = {
  code: string;
  name: string;
  risk: number;
  points: [number, number][]; // [x,z] local meters, largest ring only
};

type Ring = [number, number][]; // [[lng,lat],...]
type Geom = { type: string; coordinates: unknown };
type Feature = { properties?: Record<string, unknown>; geometry?: Geom };
type FC = { features?: Feature[] };

const ringArea = (r: Ring) => {
  let a = 0;
  for (let i = 0; i < r.length - 1; i++) a += r[i][0] * r[i + 1][1] - r[i + 1][0] * r[i][1];
  return Math.abs(a / 2);
};

export function riskShapes(fc: FC, origin: Origin): RiskShape[] {
  const out: RiskShape[] = [];
  for (const f of fc.features ?? []) {
    const g = f.geometry;
    if (!g) continue;
    const rings: Ring[] =
      g.type === "Polygon"
        ? [(g.coordinates as Ring[])[0]]
        : g.type === "MultiPolygon"
          ? (g.coordinates as Ring[][]).map((p) => p[0])
          : [];
    if (!rings.length) continue;
    const biggest = rings.reduce((a, b) => (ringArea(b) > ringArea(a) ? b : a));
    const p = f.properties ?? {};
    out.push({
      code: String(p.code ?? ""),
      name: String(p.name ?? p.code ?? ""),
      risk: Math.min(1, Math.max(0, Number(p.risk) || 0)),
      points: biggest.map(([lng, lat]) => lngLatToXZ(lng, lat, origin)),
    });
  }
  return out;
}

export async function fetchMunicipalities(): Promise<FC | null> {
  try {
    const r = await fetch("/api/municipalities");
    return r.ok ? ((await r.json()) as FC) : null;
  } catch {
    return null;
  }
}

// low -> amber, high -> danger red (same family as the app's error/tertiary)
const RAMP: [number, string][] = [
  [0.0, "#5e8f7d"],
  [0.25, "#c9b458"],
  [0.55, "#d98a3d"],
  [0.8, "#d94f3d"],
  [1.0, "#ff2d55"],
];

function riskColor(T: Three, risk: number): THREE.Color {
  let lo = RAMP[0], hi = RAMP[RAMP.length - 1];
  for (let i = 0; i < RAMP.length - 1; i++) {
    if (risk >= RAMP[i][0] && risk <= RAMP[i + 1][0]) {
      lo = RAMP[i];
      hi = RAMP[i + 1];
      break;
    }
  }
  const f = hi[0] === lo[0] ? 0 : (risk - lo[0]) / (hi[0] - lo[0]);
  return new T.Color(lo[1]).lerp(new T.Color(hi[1]), f);
}

export function buildRiskPrisms(
  T: Three,
  shapes: RiskShape[],
  elevAt: (x: number, z: number) => number,
  maxHeight = 9000
): THREE.Group {
  const group = new T.Group();
  for (const s of shapes) {
    if (s.risk <= 0.02 || s.points.length < 3) continue;
    const sh = new T.Shape(s.points.map(([x, z]) => new T.Vector2(x, -z))); // shape y = -z (shape flips back)
    const depth = 400 + s.risk * maxHeight;
    const geo = new T.ExtrudeGeometry(sh, { depth, bevelEnabled: false });
    geo.rotateX(-Math.PI / 2); // extrusion up +y; shape y=-z lands back on scene z
    const cx = s.points.reduce((a, p) => a + p[0], 0) / s.points.length;
    const cz = s.points.reduce((a, p) => a + p[1], 0) / s.points.length;
    geo.translate(0, elevAt(cx, cz), 0);
    const mat = new T.MeshStandardMaterial({
      color: riskColor(T, s.risk),
      transparent: true,
      opacity: 0.72,
      roughness: 0.55,
      metalness: 0.15,
      emissive: riskColor(T, s.risk),
      emissiveIntensity: 0.16 + s.risk * 0.25,
      side: T.DoubleSide,
    });
    const mesh = new T.Mesh(geo, mat);
    mesh.name = `risk-${s.code}`;
    mesh.userData = { name: s.name, risk: s.risk };
    group.add(mesh);
  }
  return group;
}

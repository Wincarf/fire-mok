// Pure geo/mesh helpers for the cinematic scene — no three.js, no DOM.
// Coordinate system: local equirectangular meters. Origin = AOI center,
// +x east, +z north (three.js right-handed, y up).

export type Origin = { lng: number; lat: number };

const M_PER_DEG_LNG = 111320; // * cos(lat)
const M_PER_DEG_LAT = 110540;

export function lngLatToXZ(lng: number, lat: number, o: Origin): [number, number] {
  const x = (lng - o.lng) * Math.cos((o.lat * Math.PI) / 180) * M_PER_DEG_LNG;
  const z = (lat - o.lat) * M_PER_DEG_LAT;
  return [x, z];
}

export function decodeHeightmap(buf: ArrayBuffer, nx: number, ny: number): Float32Array {
  if (buf.byteLength !== nx * ny * 4)
    throw new Error(`heightmap size mismatch: got ${buf.byteLength}B, expected ${nx * ny * 4}B`);
  return new Float32Array(buf);
}

// elevation-driven terrain palette (linear RGB ramps) — dark slate "map"
const C_LOW = [0.051, 0.086, 0.118]; // #0d161e deep basin
const C_MID = [0.118, 0.176, 0.235]; // #1e2d3c slate
const C_HIGH = [0.298, 0.392, 0.478]; // #4c647a pale ridge

function elevColor(t: number, out: [number, number, number]) {
  const k = Math.min(1, Math.max(0, t)) * 2;
  const [a, b, f] = k <= 1 ? [C_LOW, C_MID, k] : [C_MID, C_HIGH, k - 1];
  out[0] = a[0] + (b[0] - a[0]) * f;
  out[1] = a[1] + (b[1] - a[1]) * f;
  out[2] = a[2] + (b[2] - a[2]) * f;
}

export type TerrainArrays = {
  positions: Float32Array;
  uvs: Float32Array;
  indices: Uint32Array;
  colors: Float32Array;
};

export function buildTerrainArrays(
  elev: Float32Array,
  nx: number,
  ny: number,
  cell: number,
  exag: number
): TerrainArrays {
  const positions = new Float32Array(nx * ny * 3);
  const uvs = new Float32Array(nx * ny * 2);
  const colors = new Float32Array(nx * ny * 3);
  const indices = new Uint32Array((nx - 1) * (ny - 1) * 6);

  let mn = Infinity, mx = -Infinity;
  for (const v of elev) {
    if (v < mn) mn = v;
    if (v > mx) mx = v;
  }
  const span = mx - mn || 1;
  const x0 = ((nx - 1) * cell) / 2;
  const z0 = ((ny - 1) * cell) / 2;
  const c: [number, number, number] = [0, 0, 0];

  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      const vi = j * nx + i;
      positions[vi * 3] = i * cell - x0;
      positions[vi * 3 + 1] = elev[vi] * exag;
      // row 0 = north edge -> +z; rows go south so z decreases with j
      positions[vi * 3 + 2] = z0 - j * cell;
      uvs[vi * 2] = i / (nx - 1);
      uvs[vi * 2 + 1] = j / (ny - 1);
      elevColor((elev[vi] - mn) / span, c);
      colors[vi * 3] = c[0];
      colors[vi * 3 + 1] = c[1];
      colors[vi * 3 + 2] = c[2];
    }
  }

  let w = 0;
  for (let j = 0; j < ny - 1; j++) {
    for (let i = 0; i < nx - 1; i++) {
      const a = j * nx + i;
      const b = a + 1;
      const cc = a + nx;
      const d = cc + 1;
      indices[w++] = a; indices[w++] = b; indices[w++] = cc;
      indices[w++] = b; indices[w++] = d; indices[w++] = cc;
    }
  }
  return { positions, uvs, indices, colors };
}

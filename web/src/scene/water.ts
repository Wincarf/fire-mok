import type * as THREE from "three";
import type { SceneData } from "./world";

type Three = typeof import("three");

const VERT = /* glsl */ `
varying vec2 vUv;
varying vec3 vPos;
void main() {
  vUv = uv;
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vPos = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

const FRAG = /* glsl */ `
uniform sampler2D uMask;
uniform float uTime;
uniform vec3 uDeep, uShallow, uSky, uSunDir;
uniform vec2 uTexel;
varying vec2 vUv;
varying vec3 vPos;

// analytic wave normals — three moving sine octaves over world xz
vec3 waveNormal(vec2 p, float t) {
  float dx = 0.0, dz = 0.0;
  dx += 0.9 * cos(dot(p, vec2(0.013, 0.007)) + t * 0.9);
  dz += 0.9 * cos(dot(p, vec2(0.007, 0.013)) + t * 1.1);
  dx += 0.45 * cos(dot(p, vec2(0.031, -0.017)) + t * 1.6);
  dz += 0.45 * cos(dot(p, vec2(-0.023, 0.029)) + t * 1.3);
  dx += 0.2 * cos(dot(p, vec2(0.061, 0.043)) + t * 2.4);
  dz += 0.2 * cos(dot(p, vec2(0.047, -0.059)) + t * 2.1);
  return normalize(vec3(-dx * 0.35, 1.0, -dz * 0.35));
}

void main() {
  // mask row 0 = north; PlaneGeometry rotated -90deg puts v=1 on the
  // south edge (z=-h/2) which also maps to mask row ny-1 -> vUv as-is
  vec2 mUv = vUv;
  float mask = texture2D(uMask, mUv).r;
  if (mask < 0.5) discard;

  // shore band: mask falls off toward neighbors -> foam
  float edge = 0.0;
  edge += texture2D(uMask, mUv + vec2(uTexel.x, 0.0)).r;
  edge += texture2D(uMask, mUv - vec2(uTexel.x, 0.0)).r;
  edge += texture2D(uMask, mUv + vec2(0.0, uTexel.y)).r;
  edge += texture2D(uMask, mUv - vec2(0.0, uTexel.y)).r;
  float foam = (4.0 - edge) * 0.5; // 0 deep inside, up to ~1 near shore

  vec3 n = waveNormal(vPos.xz, uTime);
  vec3 viewDir = normalize(cameraPosition - vPos);
  float fres = pow(1.0 - max(dot(n, viewDir), 0.0), 3.0);

  vec3 col = mix(uDeep, uShallow, 0.25);
  col = mix(col, uSky, fres * 0.75);

  vec3 hv = normalize(viewDir + uSunDir);
  float spec = pow(max(dot(n, hv), 0.0), 90.0) * 1.4;
  col += vec3(1.0, 0.85, 0.6) * spec;

  // slow drifting foam sparkle
  float sparkle = sin(dot(vPos.xz, vec2(0.4, 0.33)) + uTime * 2.0) * 0.5 + 0.5;
  col = mix(col, vec3(0.65, 0.92, 0.98), clamp(foam * (0.4 + sparkle * 0.4), 0.0, 0.55));

  gl_FragColor = vec4(col, 0.86 + fres * 0.1);
}
`;

export function buildWater(
  T: Three,
  data: SceneData,
  nx: number,
  ny: number,
  cell: number,
  exag: number
): { mesh: THREE.Mesh; update(t: number): void; dispose(): void } {
  // water level = median elevation of flooded cells — they sit at the
  // waterline by construction of the flood extent
  const flooded: number[] = [];
  for (let i = 0; i < data.mask.length; i++)
    if (data.mask[i] === 1) flooded.push(data.elev[i]);
  flooded.sort((a, b) => a - b);
  const level = (flooded.length ? flooded[flooded.length >> 1] : 2) * exag + 2;

  const maskTex = new T.DataTexture(data.mask, nx, ny, T.RedFormat, T.UnsignedByteType);
  maskTex.magFilter = T.LinearFilter;
  maskTex.minFilter = T.LinearFilter;
  maskTex.flipY = false;
  maskTex.needsUpdate = true;

  const mat = new T.ShaderMaterial({
    vertexShader: VERT,
    fragmentShader: FRAG,
    transparent: true,
    depthWrite: false,
    uniforms: {
      uMask: { value: maskTex },
      uTime: { value: 0 },
      uDeep: { value: new T.Color("#07293d") },
      uShallow: { value: new T.Color("#0e5a74") },
      uSunDir: { value: new T.Vector3(-0.55, 0.22, 0.4).normalize() },
      uSky: { value: new T.Color("#59b8d4") },
      uTexel: { value: new T.Vector2(1 / nx, 1 / ny) },
    },
  });
  const geo = new T.PlaneGeometry(nx * cell, ny * cell, 1, 1);
  geo.rotateX(-Math.PI / 2);
  const mesh = new T.Mesh(geo, mat);
  mesh.position.y = level;
  mesh.renderOrder = 2;
  return {
    mesh,
    update(t) {
      mat.uniforms.uTime.value = t;
    },
    dispose() {
      geo.dispose();
      mat.dispose();
      maskTex.dispose();
    },
  };
}

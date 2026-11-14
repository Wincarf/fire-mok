import type * as THREE from "three";

type Three = typeof import("three");

const SKY_VERT = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = position;
  vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  gl_Position = p.xyww; // always at far plane
}
`;

const SKY_FRAG = /* glsl */ `
uniform vec3 uZenith, uHorizon, uSunDir, uSunGlow;
varying vec3 vDir;
void main() {
  vec3 d = normalize(vDir);
  float h = clamp(d.y, 0.0, 1.0);
  vec3 col = mix(uHorizon, uZenith, pow(h, 0.65));
  float g = pow(max(dot(d, uSunDir), 0.0), 6.0);
  col += uSunGlow * g * 0.55;
  gl_FragColor = vec4(col, 1.0);
}
`;

export function buildSky(T: Three, scene: THREE.Scene, extent: { w: number; d: number }) {
  const R = Math.max(extent.w, extent.d) * 4;
  const sunDir = new T.Vector3(-0.55, 0.22, 0.4).normalize(); // low west sun

  const skyMat = new T.ShaderMaterial({
    vertexShader: SKY_VERT,
    fragmentShader: SKY_FRAG,
    side: T.BackSide,
    depthWrite: false,
    uniforms: {
      uZenith: { value: new T.Color("#16233a") },
      uHorizon: { value: new T.Color("#c98a5e") },
      uSunDir: { value: sunDir },
      uSunGlow: { value: new T.Color("#ffb27a") },
    },
  });
  const dome = new T.Mesh(new T.SphereGeometry(R, 24, 12), skyMat);
  dome.frustumCulled = false;
  dome.renderOrder = -1;
  scene.add(dome);

  scene.fog = new T.Fog(new T.Color("#3a3348"), extent.w * 0.6, R * 0.9);

  const sun = new T.DirectionalLight("#ffb27a", 2.4);
  sun.position.copy(sunDir).multiplyScalar(extent.w);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  const s = Math.max(extent.w, extent.d) * 0.55;
  Object.assign(sun.shadow.camera, { left: -s, right: s, top: s, bottom: -s, near: 1, far: extent.w * 4 });
  scene.add(sun);
  scene.add(sun.target);

  scene.add(new T.HemisphereLight("#5a6f94", "#33291f", 0.55));
  scene.add(new T.AmbientLight("#33405a", 0.35));
}

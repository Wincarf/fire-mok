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
  vec3 col = mix(uHorizon, uZenith, pow(h, 0.6));
  float g = pow(max(dot(d, uSunDir), 0.0), 8.0);
  col += uSunGlow * g * 0.5;
  gl_FragColor = vec4(col, 1.0);
}
`;

export function buildSky(T: Three, scene: THREE.Scene, extent: { w: number; d: number }) {
  const R = Math.max(extent.w, extent.d) * 4;
  const sunDir = new T.Vector3(-0.55, 0.22, 0.4).normalize(); // low west light

  const skyMat = new T.ShaderMaterial({
    vertexShader: SKY_VERT,
    fragmentShader: SKY_FRAG,
    side: T.BackSide,
    depthWrite: false,
    uniforms: {
      uZenith: { value: new T.Color("#060a12") },  // deep night
      uHorizon: { value: new T.Color("#16283a") }, // cold teal horizon
      uSunDir: { value: sunDir },
      uSunGlow: { value: new T.Color("#2e7fa6") }, // cyan glow, not amber
    },
  });
  const dome = new T.Mesh(new T.SphereGeometry(R, 24, 12), skyMat);
  dome.frustumCulled = false;
  dome.renderOrder = -1;
  scene.add(dome);

  scene.fog = new T.Fog(new T.Color("#0a1420"), extent.w * 0.7, R * 0.9);

  // cool key light — reads like moonlight/floodlight, keeps terrain slate
  const sun = new T.DirectionalLight("#9fc8e8", 1.6);
  sun.position.copy(sunDir).multiplyScalar(extent.w);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  const s = Math.max(extent.w, extent.d) * 0.55;
  Object.assign(sun.shadow.camera, { left: -s, right: s, top: s, bottom: -s, near: 1, far: extent.w * 4 });
  scene.add(sun);
  scene.add(sun.target);

  scene.add(new T.HemisphereLight("#2c4a66", "#0a0f14", 0.5));
  scene.add(new T.AmbientLight("#22334a", 0.4));
}

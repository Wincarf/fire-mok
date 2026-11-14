// Scene orchestrator — single dynamic-import site for three.js so the
// library never lands in the app's main bundle.
import type * as THREE from "three";
import type { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { lngLatToXZ, decodeHeightmap, buildTerrainArrays } from "./geo";
import { buildTerrain } from "./terrain";
import { buildWater } from "./water";
import { buildSky } from "./sky";
import { buildPost } from "./post";
import { createRig } from "./camera";

export type SceneMeta = {
  bounds: [number, number, number, number];
  nx: number;
  ny: number;
  cellsize_m: number;
};
export type SceneData = { meta: SceneMeta; elev: Float32Array; mask: Uint8Array };

export async function loadSceneData(): Promise<SceneData> {
  const meta = (await (await fetch("/api/scene")).json()) as SceneMeta;
  const [h, f] = await Promise.all([
    fetch("/api/scene/heightmap").then((r) => r.arrayBuffer()),
    fetch("/api/scene/flood").then((r) => r.arrayBuffer()),
  ]);
  return { meta, elev: decodeHeightmap(h, meta.nx, meta.ny), mask: new Uint8Array(f) };
}

export type World = {
  extent: { w: number; d: number; maxH: number };
  origin: { lng: number; lat: number };
  resize(w: number, h: number): void;
  flyTo(pos: [number, number, number], look: [number, number, number], ms: number): void;
  addObject(obj: unknown): void;
  exportStill(w: number, h: number): Promise<Blob | null>;
  dispose(): void;
};

export async function createWorld(canvas: HTMLCanvasElement, data: SceneData): Promise<World> {
  const T = await import("three");
  const { nx, ny, cellsize_m: cell, bounds } = data.meta;
  const [bw, bs, be, bn] = bounds;
  const origin = { lng: (bw + be) / 2, lat: (bs + bn) / 2 };
  const exag = 2.5;

  const renderer = new T.WebGLRenderer({
    canvas,
    antialias: true,
    preserveDrawingBuffer: true, // needed by exportStill -> canvas.toBlob
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(canvas.clientWidth || 1, canvas.clientHeight || 1, false);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = T.PCFSoftShadowMap;
  renderer.outputColorSpace = T.SRGBColorSpace;
  renderer.toneMapping = T.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;

  const scene = new T.Scene();
  const camera = new T.PerspectiveCamera(
    50,
    (canvas.clientWidth || 1) / (canvas.clientHeight || 1),
    50,
    300000
  );

  let maxH = 0;
  for (const v of data.elev) if (v > maxH) maxH = v;
  const extent = { w: nx * cell, d: ny * cell, maxH: maxH * exag };

  const terrain = buildTerrain(T, buildTerrainArrays(data.elev, nx, ny, cell, exag));
  scene.add(terrain);

  const water = buildWater(T, data, nx, ny, cell, exag);
  scene.add(water.mesh);

  buildSky(T, scene, extent);
  const composer: EffectComposer = await buildPost(T, renderer, scene, camera);
  const rig = await createRig(T, camera, canvas);

  camera.position.set(-extent.w * 0.25, extent.maxH * 8 + 9000, -extent.d * 0.85);
  rig.target.set(0, extent.maxH * 0.4, 0);
  rig.update();

  // flight tween — applied inside the RAF loop so damping stays smooth
  let flight: {
    p0: THREE.Vector3; p1: THREE.Vector3;
    t0: THREE.Vector3; t1: THREE.Vector3;
    start: number; ms: number;
  } | null = null;

  const clock = new T.Clock();
  let raf = 0;
  const loop = () => {
    raf = requestAnimationFrame(loop);
    if (flight) {
      const k = Math.min(1, (performance.now() - flight.start) / flight.ms);
      const e = k * k * (3 - 2 * k); // smoothstep
      camera.position.lerpVectors(flight.p0, flight.p1, e);
      rig.target.lerpVectors(flight.t0, flight.t1, e);
      if (k >= 1) flight = null;
    }
    water.update(clock.getElapsedTime());
    rig.update();
    composer.render();
  };
  loop();

  return {
    extent,
    origin,
    resize(w, h) {
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h, false);
      composer.setSize(w, h);
    },
    flyTo(pos, look, ms) {
      flight = {
        p0: camera.position.clone(),
        p1: new T.Vector3(...pos),
        t0: rig.target.clone(),
        t1: new T.Vector3(...look),
        start: performance.now(),
        ms,
      };
    },
    addObject(obj) {
      scene.add(obj as THREE.Object3D);
    },
    async exportStill(w, h) {
      const pw = canvas.clientWidth, ph = canvas.clientHeight, pr = renderer.getPixelRatio();
      renderer.setPixelRatio(1);
      renderer.setSize(w, h, false);
      composer.setSize(w, h);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      composer.render();
      const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, "image/png"));
      renderer.setPixelRatio(pr);
      renderer.setSize(pw, ph, false);
      composer.setSize(pw, ph);
      camera.aspect = pw / ph;
      camera.updateProjectionMatrix();
      return blob;
    },
    dispose() {
      cancelAnimationFrame(raf);
      rig.dispose();
      water.dispose(); // disposes maskTex too
      scene.traverse((o) => {
        const m = o as THREE.Mesh;
        m.geometry?.dispose();
        const mat = m.material as THREE.Material | THREE.Material[] | undefined;
        (Array.isArray(mat) ? mat : mat ? [mat] : []).forEach((x) => x.dispose());
      });
      composer.dispose();
      renderer.dispose();
    },
  };
}

export { lngLatToXZ };

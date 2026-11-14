import type * as THREE from "three";

type Three = typeof import("three");
type OrbitControls = import("three/examples/jsm/controls/OrbitControls.js").OrbitControls;

export async function createRig(
  T: Three,
  camera: THREE.PerspectiveCamera,
  dom: HTMLElement
): Promise<OrbitControls> {
  const { OrbitControls } = await import("three/examples/jsm/controls/OrbitControls.js");
  const c = new OrbitControls(camera, dom);
  c.enableDamping = true;
  c.dampingFactor = 0.06;
  c.maxPolarAngle = 1.45; // ~83° — stays above the waterline
  c.minDistance = 200;
  c.maxDistance = 120000;
  c.screenSpacePanning = false;
  return c;
}

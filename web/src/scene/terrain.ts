import type * as THREE from "three";
import type { TerrainArrays } from "./geo";

type Three = typeof import("three");

export function buildTerrain(T: Three, t: TerrainArrays): THREE.Mesh {
  const g = new T.BufferGeometry();
  g.setAttribute("position", new T.BufferAttribute(t.positions, 3));
  g.setAttribute("uv", new T.BufferAttribute(t.uvs, 2));
  g.setAttribute("color", new T.BufferAttribute(t.colors, 3));
  g.setIndex(new T.BufferAttribute(t.indices, 1));
  g.computeVertexNormals();
  const m = new T.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.92,
    metalness: 0.02,
  });
  const mesh = new T.Mesh(g, m);
  mesh.receiveShadow = true;
  mesh.castShadow = true;
  return mesh;
}

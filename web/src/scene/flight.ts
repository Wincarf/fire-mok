// Story -> camera keyframes. Pure (no three) so it stays in the app bundle.
import { lngLatToXZ, type Origin } from "./geo";
import type { Step } from "../story";

export type Keyframe = {
  pos: [number, number, number];
  look: [number, number, number];
  ms: number;
};

// maplibre zoom -> scene altitude (m): z9 ≈ 45 km, each +1 halves it
const altForZoom = (z: number) => Math.max(600, 45000 / 2 ** (z - 9));

export function storyFlight(steps: Step[], origin: Origin, ms = 6500): Keyframe[] {
  return steps.map((s) => {
    const [lng, lat, zoom] = s.camera;
    const [x, z] = lngLatToXZ(lng, lat, origin);
    const alt = altForZoom(zoom);
    return {
      pos: [x - alt * 0.35, alt, z - alt * 0.75],
      look: [x, 0, z],
      ms,
    };
  });
}

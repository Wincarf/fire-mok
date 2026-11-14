import type { World } from "./world";

// Render the CURRENT view at 4K and trigger a PNG download.
// Returns false when WebGL couldn't produce a blob (context lost etc).
export async function exportPoster(world: World): Promise<boolean> {
  const blob = await world.exportStill(3840, 2160);
  if (!blob) return false;
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `fire-mok-guaiba-${Date.now()}.png`;
  a.click();
  URL.revokeObjectURL(a.href);
  return true;
}

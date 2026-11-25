// The landing's hero map: the real Guaíba AOI with a darkened OSM basemap and
// the flood_extent raster revealed once — the "water where it shouldn't be"
// moment. Non-interactive; attribution lives in the landing footer.
import * as maplibregl from "maplibre-gl";
import type { StyleSpecification } from "maplibre-gl";
import { withBase } from "../api";
import { FLOOD_CMAP } from "../mapStyle";

const HERO_CENTER: [number, number] = [-51.18, -30.04];
const HERO_ZOOM = 9.15;
const FLOOD_TARGET_OPACITY = 0.82;
const REVEAL_DELAY_MS = 450;
const REVEAL_DURATION_MS = 1600;

const reducedMotion = () =>
  typeof window !== "undefined" &&
  window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

function heroStyle(): StyleSpecification {
  return {
    version: 8,
    sources: {
      osm: {
        type: "raster",
        tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
        tileSize: 256,
        attribution: "© OpenStreetMap",
      },
      flood: {
        type: "raster",
        tiles: [withBase(`/tiles/flood_extent/{z}/{x}/{y}.png?colormap=${FLOOD_CMAP}`)],
        tileSize: 256,
      },
    },
    layers: [
      {
        id: "osm",
        type: "raster",
        source: "osm",
        // dark, desaturated basemap — the red flood is the only accent
        paint: {
          "raster-brightness-max": 0.55,
          "raster-saturation": -0.55,
          "raster-contrast": 0.12,
        },
      },
      {
        id: "flood",
        type: "raster",
        source: "flood",
        paint: { "raster-opacity": 0 },
      },
    ],
  };
}

/** One orchestrated entrance: the flood extent lights up over the darkened
 * basemap, then a slow camera drift. Honors prefers-reduced-motion.
 * Returns the cleanup (cancel animation + remove the map). */
export function createHeroMap(container: HTMLDivElement): () => void {
  const m = new maplibregl.Map({
    container,
    style: heroStyle(),
    center: HERO_CENTER,
    zoom: HERO_ZOOM,
    interactive: false,
    attributionControl: false,
    fadeDuration: 300,
  });

  let raf = 0;
  m.once("load", () => {
    if (reducedMotion()) {
      m.setPaintProperty("flood", "raster-opacity", FLOOD_TARGET_OPACITY);
      return;
    }
    const t0 = performance.now() + REVEAL_DELAY_MS;
    const tick = (t: number) => {
      const p = Math.min(1, Math.max(0, (t - t0) / REVEAL_DURATION_MS));
      const eased = 1 - Math.pow(1 - p, 3);
      if (m.getLayer("flood")) {
        m.setPaintProperty("flood", "raster-opacity", FLOOD_TARGET_OPACITY * eased);
      }
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    m.easeTo({ zoom: HERO_ZOOM + 0.35, duration: 14000, easing: (t) => t });
  });

  return () => {
    cancelAnimationFrame(raf);
    m.remove();
  };
}

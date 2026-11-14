import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // maplibre v6 ships its geojson worker as a sibling module — the deps
  // optimizer prebundle loses that relative import (worker 404 => geojson
  // sources never process). Serve the package ESM as-is.
  optimizeDeps: { exclude: ["maplibre-gl"] },
  server: {
    port: 5173,
    proxy: { "/api": "http://127.0.0.1:8000", "/tiles": "http://127.0.0.1:8000" },
  },
});

import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig, loadEnv } from "vite";

export default defineConfig(({ mode }) => {
  const api = loadEnv(mode, process.cwd(), "FIREMOK_API").FIREMOK_API
    ?? process.env.FIREMOK_API
    ?? "http://127.0.0.1:8000";
  return {
    plugins: [react(), tailwindcss()],
    server: {
      port: 5173,
      proxy: { "/api": api, "/tiles": api },
    },
  };
});

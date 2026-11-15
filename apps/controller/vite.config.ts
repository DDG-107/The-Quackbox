import { defineConfig } from "vite";

const HUB = "http://127.0.0.1:4321";

export default defineConfig({
  server: {
    port: 5173,
    strictPort: true,
    // Dev only: the built controller is served by the hub itself, so the
    // production path needs no proxy.
    proxy: {
      "/ws": { target: "ws://127.0.0.1:4321", ws: true },
      "/health": { target: HUB },
    },
  },
  build: {
    target: "es2022",
    outDir: "dist",
    emptyOutDir: true,
  },
});

import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";
export default defineConfig({
  plugins: [react()],
  server: { host: "127.0.0.1", port: 5189, strictPort: true, proxy: { "/api": "http://127.0.0.1:5188", "/auth": "http://127.0.0.1:5188" } },
  build: { outDir: "dist-platform", emptyOutDir: false, manifest: true, rollupOptions: { input: resolve(import.meta.dirname, "platform.html") } },
});

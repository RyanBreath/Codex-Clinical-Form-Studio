import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { sites } from "./build/sites-vite-plugin";

export default defineConfig({
  base: "./",
  resolve: { preserveSymlinks: true },
  plugins: [react(), sites()],
  build: {
    outDir: "dist/client",
    emptyOutDir: true,
    manifest: true,
    sourcemap: false,
  },
});

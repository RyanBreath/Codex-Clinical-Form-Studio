import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const outDir = resolve(__dirname, "dist-studio");

export default defineConfig({
  base: "/",
  plugins: [
    react(),
    {
      name: "airwayai-studio-portable-entry",
      closeBundle() {
        const indexPath = resolve(outDir, "studio.html");
        if (!existsSync(indexPath)) return;
        const html = readFileSync(indexPath, "utf8").replace(
          /(src|href)="\/assets\//g,
          '$1="./assets/',
        );
        writeFileSync(indexPath, html, "utf8");
      },
    },
  ],
  build: {
    outDir,
    emptyOutDir: false,
    rollupOptions: {
      input: resolve(__dirname, "studio.html"),
    },
  },
});

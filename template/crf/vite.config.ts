import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const defaultSchemaPath = resolve(__dirname, "../data-dictionaries/crf-schema.json");

export default defineConfig(() => {
  const schemaPath = resolve(process.env.AIRWAYAI_CRF_SCHEMA_PATH ?? defaultSchemaPath);
  const outDir = resolve(process.env.AIRWAYAI_OUT_DIR ?? resolve(__dirname, "dist-demo"));
  const port = Number.parseInt(process.env.AIRWAYAI_PREVIEW_PORT ?? "4173", 10);

  if (!existsSync(schemaPath)) {
    throw new Error(`找不到 AIRWAYAI_CRF_SCHEMA_PATH：${schemaPath}`);
  }
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("AIRWAYAI_PREVIEW_PORT 必須是有效的 TCP port。");
  }

  return {
    // Vite 8／Rolldown on Windows crashes with a relative base. Build with `/`
    // and rewrite only the generated entry asset URLs after bundling.
    base: "/",
    plugins: [
      react(),
      {
        name: "airwayai-portable-static-entry",
        closeBundle() {
          const indexPath = resolve(outDir, "index.html");
          if (!existsSync(indexPath)) return;
          const html = readFileSync(indexPath, "utf8").replace(
            /(src|href)="\/assets\//g,
            '$1="./assets/',
          );
          writeFileSync(indexPath, html, "utf8");
        },
      },
    ],
    resolve: {
      alias: {
        "@airwayai/active-crf-schema": schemaPath,
      },
    },
    server: {
      host: "127.0.0.1",
      port,
    },
    preview: {
      host: "127.0.0.1",
      port,
    },
    build: {
      outDir,
      // Cloud-synced Windows folders can crash Rolldown while recursively
      // emptying an existing output directory. Release builds always use a
      // fresh immutable staging directory, so deletion is unnecessary.
      emptyOutDir: false,
    },
  };
});

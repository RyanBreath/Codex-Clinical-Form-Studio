import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    globals: true,
    exclude: ["e2e/**", "scripts/**", "node_modules/**", "dist/**", "dist-demo/**", "dist-platform/**", "dist-studio/**"],
    testTimeout: 20_000,
    css: true,
    coverage: {
      reporter: ["text", "html"],
    },
  },
});

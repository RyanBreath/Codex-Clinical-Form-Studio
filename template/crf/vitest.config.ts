import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    globals: true,
    exclude: ["e2e/**", "node_modules/**", "dist/**", "dist-demo/**"],
    testTimeout: 20_000,
    css: true,
    coverage: {
      reporter: ["text", "html"],
    },
  },
});

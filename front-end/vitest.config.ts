import react from "@vitejs/plugin-react";
import path from "node:path";
import { defineConfig } from "vitest/config";

/**
 * Test configuration, separate from the build so neither complicates the other.
 *
 * The integration suite drives the real API layer against a running backend,
 * which is why it needs the same `@` alias and the same `VITE_APP_` variables
 * the application reads at startup.
 */
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { "@": path.resolve(__dirname, "./src") },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
    // Each file shares one backend, so they must not race each other.
    fileParallelism: false,
    env: {
      VITE_APP_API_URL: process.env.VITE_APP_API_URL ?? "http://localhost:5000",
    },
  },
});

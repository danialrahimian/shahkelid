import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import path from "node:path";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],

  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },

  /**
   * No manualChunks: Rollup splits by the import graph, which keeps every
   * chunk's imports one-way. A hand-made split by path ("vendor-react",
   * "vendor-forms", a catch-all "vendor") put libraries apart from what they
   * import (scheduler from react-dom, @hookform/resolvers from
   * react-hook-form), the chunks imported one another in a ring, and the
   * built site stopped with "Cannot access 'L' before initialization".
   */
});

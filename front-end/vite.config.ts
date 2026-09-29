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

  build: {
    rollupOptions: {
      output: {
        /**
         * Split the dependencies that never change away from the application
         * code that does.
         *
         * Routes already load lazily, but they all shared one 720kB vendor
         * chunk, so shipping a one-line fix invalidated the whole download for
         * every returning visitor. Grouping by library means a release only
         * busts the cache for the chunks it actually touched.
         */
        manualChunks: (id) => {
          if (!id.includes("node_modules")) return undefined;

          if (id.includes("motion")) return "vendor-motion";
          if (id.includes("react-dom") || id.includes("/react/")) {
            return "vendor-react";
          }
          if (id.includes("@reduxjs") || id.includes("react-redux")) {
            return "vendor-redux";
          }
          if (id.includes("radix-ui") || id.includes("vaul")) {
            return "vendor-ui";
          }
          if (id.includes("react-hook-form") || id.includes("zod")) {
            return "vendor-forms";
          }
          if (id.includes("lucide-react")) return "vendor-icons";

          return "vendor";
        },
      },
    },
  },
});

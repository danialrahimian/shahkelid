import js from "@eslint/js";
import { defineConfig, globalIgnores } from "eslint/config";
import checkFile from "eslint-plugin-check-file";
import importPlugin from "eslint-plugin-import";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import globals from "globals";
import tseslint from "typescript-eslint";

export default defineConfig([
  globalIgnores(["dist", "node_modules"]),

  {
    files: ["**/*.{ts,tsx}"],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    plugins: {
      import: importPlugin,
      "check-file": checkFile,
    },
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
    settings: {
      "import/resolver": {
        typescript: {},
        node: { extensions: [".ts", ".tsx"] },
      },
    },
    rules: {
      /**
       * A unidirectional codebase: shared code flows into features, and
       * features flow into the app. Nothing flows back.
       *
       * Without this the layering is a convention that quietly erodes. The
       * rule is what makes it a fact: a shared component cannot reach into a
       * feature, and one feature cannot reach into another. Where two features
       * genuinely need the same request, the declaration lives in `src/api`,
       * which every layer may read.
       */
      "import/no-restricted-paths": [
        "error",
        {
          zones: [
            // No feature may import another feature. Compose them in `app`.
            ...[
              "account",
              "admin",
              "auth",
              "crm",
              "dashboard",
              "marketing",
              "moderator",
              "orders",
              "posts",
              "profile",
              "shop",
              "staff",
              "support",
            ].map((feature) => ({
              target: `./src/features/${feature}`,
              from: "./src/features",
              except: [`./${feature}`],
            })),

            // The app may use features; features may not reach back into it.
            {
              target: "./src/features",
              from: "./src/app",
            },

            // Shared modules are the foundation, so they cannot depend on the
            // layers built on top of them.
            {
              target: [
                "./src/components",
                "./src/hooks",
                "./src/lib",
                "./src/types",
                "./src/utils",
                "./src/config",
                "./src/api",
                "./src/locales",
              ],
              from: ["./src/features", "./src/app"],
            },
          ],
        },
      ],

      // Files are kebab-case throughout, so a path is predictable from a name.
      "check-file/filename-naming-convention": [
        "error",
        { "**/*.{ts,tsx}": "KEBAB_CASE" },
        // Lets `vite.config.ts` and the like keep their middle extension.
        { ignoreMiddleExtensions: true },
      ],
      "check-file/folder-naming-convention": [
        "error",
        { "src/**/!(__tests__)": "KEBAB_CASE" },
      ],
    },
  },

  {
    /**
     * Vendored components (shadcn and animate-ui). Their CLIs regenerate these
     * files, so edits here are overwritten; the rules they trip are relaxed
     * rather than the files being changed.
     */
    files: [
      "src/components/ui/**/*.{ts,tsx}",
      "src/components/animate-ui/**/*.{ts,tsx}",
      "src/components/theme-provider.tsx",
      "src/hooks/use-is-in-view.tsx",
    ],
    rules: {
      "react-refresh/only-export-components": "off",
      "react-hooks/purity": "off",
    },
  },

  {
    // Route modules must default-export their component for lazy loading, and
    // the router file exports a factory beside its component.
    files: ["src/app/routes/**/*.tsx", "src/app/router.tsx"],
    rules: {
      "react-refresh/only-export-components": "off",
    },
  },
]);

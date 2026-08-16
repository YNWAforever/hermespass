import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";
import eslintConfigPrettier from "eslint-config-prettier/flat";

export default defineConfig([
  ...nextVitals,
  ...nextTypescript,
  eslintConfigPrettier,
  globalIgnores([
    ".next/**",
    ".worktrees/**",
    ".output/**",
    ".vinxi/**",
    ".tanstack/**",
    ".nitro/**",
    ".wrangler/**",
    "dist/**",
    "coverage/**",
    "playwright-report/**",
    "test-results/**",
    "blob-report/**",
    "next-env.d.ts",
    "src/routeTree.gen.ts",
    "src/routes/**",
    "src/router.tsx",
    "src/server.ts",
    "src/start.ts",
  ]),
  {
    files: [
      "src/components/ui/carousel.tsx",
      "src/components/ui/sidebar.tsx",
      "src/hooks/use-mobile.tsx",
    ],
    rules: {
      "react-hooks/purity": "off",
      "react-hooks/set-state-in-effect": "off",
    },
  },
]);

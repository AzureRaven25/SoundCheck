import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    rules: {
      // Our data-fetching effects reset a "loading" flag when their key (query, user, id) changes:
      // the documented fetch-on-change pattern. Kept visible as a warning, not an error.
      'react-hooks/set-state-in-effect': 'warn',
    },
  },
  globalIgnores(['test-results/**', 'playwright-report/**']),
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;

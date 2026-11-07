// Flat ESLint configuration for the bdmv2web workspace.
//
// Linting is type-aware through `tsconfig.lint.json`, which spans every linted
// TypeScript file (package sources, `{apps,packages}/*/tests`, `vitest.config.ts`).
// Cross-package imports resolve through each package's built declarations, so
// run lint after `pnpm build` - the order `scripts/ci.sh` uses.
//
// Formatting rules are out of scope: ESLint 10 no longer ships them, the
// sources are laid out densely on purpose, and no formatter is enforced here.
import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";

const TYPED_FILES = [
  "apps/*/src/**/*.ts",
  "apps/*/tests/**/*.ts",
  "apps/*/vitest.config.ts",
  "packages/*/src/**/*.ts",
  "packages/*/tests/**/*.ts",
  "packages/*/vitest.config.ts",
];
const TEST_FILES = ["**/*.test.ts", "**/*.test-d.ts"];
const SCRIPT_FILES = ["scripts/**/*.mjs", "*.mjs"];

export default [
  {
    // Build output, generated fixtures, and local reference caches are not sources.
    ignores: [
      "**/node_modules/**",
      "**/dist/**",
      "test-data/**",
      ".reference-cache/**",
      ".codegraph/**",
      ".agents/**",
      ".codex/**",
      // Emitted by `pnpm generate:contracts` from the DiscIR JSON schema.
      "packages/core/src/disc-ir.generated.ts",
    ],
  },
  js.configs.recommended,
  // Syntax and non-type-aware rules cover every TypeScript file; type-aware
  // rules are limited to the files `tsconfig.lint.json` includes.
  ...tseslint.configs.recommended.map((config) => ({ ...config, files: ["**/*.ts"] })),
  ...tseslint.configs.recommendedTypeChecked.map((config) => ({ ...config, files: TYPED_FILES })),
  {
    files: TYPED_FILES,
    languageOptions: {
      parserOptions: {
        project: ["./tsconfig.lint.json"],
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // Parsers assert non-null once a bounds check has run
      // (`this.data[this.bit >>> 3]!`), and checkpoints restore exact state.
      "@typescript-eslint/no-non-null-assertion": "off",
      // Terse side-effect chains are the established style:
      // `hooks.onEnd?.() && settle()`, `error ? reject(error) : resolve()`.
      "no-unused-expressions": ["error", { allowShortCircuit: true, allowTernary: true }],
      "@typescript-eslint/no-unused-expressions": ["error", { allowShortCircuit: true, allowTernary: true }],
      // Diagnostic messages interpolate opcodes, PCs, register values and
      // exhaustive-switch `never` operands directly.
      "@typescript-eslint/restrict-template-expressions": ["error", { allowNumber: true, allowBoolean: true, allowNullish: true, allowRegExp: true, allowNever: true }],
      // Unused variables and caught errors are findings; unused parameters
      // document the callback and protocol signatures they implement.
      "@typescript-eslint/no-unused-vars": ["error", { args: "none", vars: "all", varsIgnorePattern: "^_", caughtErrors: "all", ignoreRestSiblings: true }],
      // The CLI keeps one active reporter in a module-level `active` registry.
      "@typescript-eslint/no-this-alias": ["error", { allowedNames: ["active"] }],
      // CLI progress and diagnostics are the product's user interface.
      "no-console": "off",
      // Renderers and adapters expose sync or fire-and-forget seams on purpose.
      "@typescript-eslint/require-await": "off",
    },
  },
  {
    files: TEST_FILES,
    rules: {
      // Tests assert on JSON parsed from CLI output, pass bound methods to
      // vitest matchers, and interpolate structured values into messages.
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-unsafe-assignment": "off",
      "@typescript-eslint/no-unsafe-member-access": "off",
      "@typescript-eslint/no-unsafe-argument": "off",
      "@typescript-eslint/no-unsafe-call": "off",
      "@typescript-eslint/no-unsafe-return": "off",
      "@typescript-eslint/unbound-method": "off",
      "@typescript-eslint/restrict-template-expressions": "off",
      // ANSI escape sequences are asserted verbatim.
      "no-control-regex": "off",
    },
  },
  {
    files: SCRIPT_FILES,
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      globals: { ...globals.node },
    },
    rules: {
      "no-unused-vars": ["error", { args: "none", varsIgnorePattern: "^_" }],
    },
  },
];

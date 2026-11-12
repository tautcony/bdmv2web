import { defineConfig } from "vitest/config";
// CLI integration cases run with a 15-second timeout.
export default defineConfig({ test: { include: ["src/**/*.test.ts", "tests/**/*.test.ts"], testTimeout: 15000, coverage: { provider: "v8", include: ["src/**/*.ts"] } } });

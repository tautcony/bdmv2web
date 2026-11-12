import { defineConfig } from "vitest/config";
// CLI cases spawn the built binary and take 5-6s under load. The default 5s timeout
// produced false failures in shared runners, so the budget is explicit here.
export default defineConfig({ test: { include: ["src/**/*.test.ts", "tests/**/*.test.ts"], testTimeout: 15000, coverage: { provider: "v8", include: ["src/**/*.ts"] } } });

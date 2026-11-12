import { defineConfig } from "vitest/config";
// Codec and export cases exceed the 5s default when the machine is busy.
export default defineConfig({ test: { environment: "node", include: ["src/**/*.test.ts"], testTimeout: 15000, coverage: { provider: "v8", include: ["src/**/*.ts"] } } });

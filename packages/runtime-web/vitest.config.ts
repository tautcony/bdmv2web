import { defineConfig } from "vitest/config";
// The 15s default covers rendering cases that run long on a busy machine. The
// navigation corpus cases keep their explicit 120_000 per-test budget, which wins.
export default defineConfig({ test: { environment: "node", include: ["src/**/*.test.ts", "tests/**/*.test.ts"], testTimeout: 15000 } });

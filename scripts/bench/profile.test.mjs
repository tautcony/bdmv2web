import test from "node:test";
import assert from "node:assert/strict";
import { captureProfile } from "./profile.mjs";
import { parseBenchArguments } from "./index.mjs";

test("CPU profile output is a Chrome DevTools profile with measured samples", async () => {
  let count = 0;
  const { profile, iterations } = await captureProfile({ mode: "cpu", durationMs: 15, run: () => { for (let i = 0; i < 1000; i++) count += i; } });
  assert.ok(iterations > 0);
  assert.ok(count > 0);
  assert.ok(Array.isArray(profile.nodes));
  assert.ok(Array.isArray(profile.samples));
  assert.ok(profile.samples.length > 0);
  assert.ok(profile.startTime < profile.endTime);
});

test("heap sampling output follows DevTools sampling profile shape", async () => {
  const { profile, iterations } = await captureProfile({ mode: "heap", durationMs: 10, run: () => new Array(256).fill({ value: "sample" }) });
  assert.ok(iterations > 0);
  assert.ok(profile.head);
  assert.ok(Array.isArray(profile.samples));
});


test("root CLI accepts all isolated measurement modes", () => {
  for (const mode of ["cpu", "heap", "memory", "browser"]) {
    assert.equal(parseBenchArguments(["--mode", mode, "--case", "browser.synthetic-menu.file-navigation"]).mode, mode);
  }
});

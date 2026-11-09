import assert from "node:assert/strict";
import test from "node:test";
import { MAX_CALLS_PER_SAMPLE, calibrateCallsPerSample, callsPerSample } from "./batch.mjs";

test("call count brings a timing sample to the target duration", () => {
  assert.equal(callsPerSample(0.000667), 1500);
  assert.equal(callsPerSample(0.5), 2);
  assert.equal(callsPerSample(5), 1);
});

test("call count is capped for durations below timer resolution", () => {
  assert.equal(callsPerSample(0), MAX_CALLS_PER_SAMPLE);
  assert.equal(callsPerSample(Number.NaN), MAX_CALLS_PER_SAMPLE);
  assert.equal(callsPerSample(1e-9), MAX_CALLS_PER_SAMPLE);
});

test("calibration runs an operation at the target once", async () => {
  let clock = 0, calls = 0;
  const count = await calibrateCallsPerSample(() => { calls += 1; clock += 5; }, { now: () => clock, warmupMs: 0 });
  assert.equal(count, 1);
  assert.equal(calls, 1);
});

test("calibration measures the call count for a sub-millisecond operation", async () => {
  let clock = 0, calls = 0;
  const count = await calibrateCallsPerSample(() => { calls += 1; clock += 0.001; }, { now: () => clock, warmupMs: 0 });
  assert.equal(count, 1000);
  assert.equal(calls, 1001);
});

test("calibration falls back to the cap when the clock reads zero", async () => {
  const count = await calibrateCallsPerSample(() => {}, { now: () => 0, warmupMs: 0 });
  assert.equal(count, MAX_CALLS_PER_SAMPLE);
});

test("calibration warms the operation before timing it", async () => {
  let clock = 0, calls = 0;
  await calibrateCallsPerSample(() => { calls += 1; clock += 0.001; }, { now: () => clock, warmupMs: 0.05 });
  assert.equal(calls, 50 + 1 + 1000);
});

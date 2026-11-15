#!/usr/bin/env node
/**
 * Preloaded into a spawned CLI child by `bench --mode child`.
 *
 * The benchmark parent cannot see the child's heap or GC. This module collects
 * both without writing to stdout, then writes one JSON report at process exit.
 */
import { PerformanceObserver } from "node:perf_hooks";
import { writeFileSync } from "node:fs";

const destination = process.env.BDMV2WEB_BENCH_CHILD_REPORT;
const startedAt = performance.now();
const events = [];
const samples = [process.memoryUsage()];
let observer;
let available = true;
let unavailableReason = null;
try {
  observer = new PerformanceObserver((list) => {
    for (const entry of list.getEntries()) events.push({ kind: entry.detail?.kind ?? null, flags: entry.detail?.flags ?? null, durationMs: entry.duration, startTimeMs: entry.startTime });
  });
  observer.observe({ entryTypes: ["gc"] });
} catch (error) {
  available = false;
  unavailableReason = error instanceof Error ? error.message : String(error);
}
const timer = setInterval(() => { if (samples.length < 512) samples.push(process.memoryUsage()); }, 20);
timer.unref?.();

function finish() {
  clearInterval(timer);
  samples.push(process.memoryUsage());
  if (observer) {
    try { for (const entry of observer.takeRecords()) events.push({ kind: entry.detail?.kind ?? null, flags: entry.detail?.flags ?? null, durationMs: entry.duration, startTimeMs: entry.startTime }); } catch { /* An exited process cannot drain more entries. */ }
    observer.disconnect();
  }
  const peak = (key) => Math.max(...samples.map((sample) => sample[key]));
  const report = {
    startedAt,
    durationMs: performance.now() - startedAt,
    gc: { available, unavailableReason, events },
    memory: {
      sampleCount: samples.length,
      heapUsedBytes: peak("heapUsed"),
      rssBytes: peak("rss"),
      externalBytes: peak("external"),
      arrayBuffersBytes: peak("arrayBuffers"),
      maxRSSBytes: process.resourceUsage().maxRSS * 1024,
    },
  };
  if (destination) {
    try { writeFileSync(destination, `${JSON.stringify(report)}\n`); } catch { /* The benchmark parent keeps the call failure, not the observer. */ }
  }
}
process.on("exit", finish);

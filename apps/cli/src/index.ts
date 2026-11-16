#!/usr/bin/env node
import { createRequire } from "node:module";
import { applyInvocationCwd } from "./cli/invocation-cwd.js";
import { runCli } from "./cli/run.js";

const { version } = createRequire(import.meta.url)("../package.json") as { version: string };
applyInvocationCwd();
void runCli(version);

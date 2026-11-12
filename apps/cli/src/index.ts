#!/usr/bin/env node
import { createRequire } from "node:module";
import { runCli } from "./cli/run.js";

const { version } = createRequire(import.meta.url)("../package.json") as { version: string };
void runCli(version);

// Copies the navigation-graph viewer sources into dist next to the compiled CLI.
import { cpSync } from "node:fs";
cpSync(new URL("../src/shared/graph-viewer", import.meta.url), new URL("../dist/shared/graph-viewer", import.meta.url), { recursive: true });

import { tsImport } from "tsx/esm/api";

await tsImport("./inspect-collection-worker.ts", {
  parentURL: import.meta.url,
  tsconfig: new URL("../../tsconfig.dev.json", import.meta.url).pathname,
});

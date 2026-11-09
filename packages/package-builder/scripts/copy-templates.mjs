import { copyFile, mkdir } from "node:fs/promises";
import { resolve } from "node:path";

const packageRoot = resolve(import.meta.dirname, "..");
const templateNames = ["index.html", "style.css", "README.md"];
const outputDirectory = resolve(packageRoot, "dist/templates");

await mkdir(outputDirectory, { recursive: true });
for (const name of templateNames) {
  await copyFile(resolve(packageRoot, "templates", name), resolve(outputDirectory, name));
}

import { assertDisjointRoots, beginOutputTransaction } from "@bdmv2web/bdmv-io";
import { parseBdmv } from "@bdmv2web/bdmv-parser";
import { buildNavigationGraph, renderProgramFlowchart } from "@bdmv2web/hdmv";
import { computeMediaClosure, createViewerPayload, renderOverviewMermaid, type OverviewProgram, type ViewerProgramSource } from "@bdmv2web/media-export";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { extractIgsScenes } from "@bdmv2web/igs";
import { fail, outputFormat } from "../cli/errors.js";
import { flagEnabled, inputPath, optionNumber, optionState, optionValue } from "../cli/context.js";
import { printTable } from "../cli/output.js";
import { renderGraphViewerHtml } from "../shared/graph-viewer-html.js";
import { buildButtonPrograms } from "../shared/media.js";

const DEFAULT_MAX_BLOCKS = 400;

/**
 * Export the navigation graph as an interactive viewer, a mermaid overview and
 * per-program flowcharts. The media closure drives provenance; `--no-closure`
 * skips IGS extraction and reports the graph without playlist reachability.
 */
export async function visualize(): Promise<void> {
  const input = inputPath(); if (!input) fail("CLI_MISSING_INPUT", "visualize requires a BDMV input path");
  const disc = await parseBdmv(input);
  const out = optionValue("--out") ?? resolve(dirname(disc.root), "BDMV-graph");
  const roots = await assertDisjointRoots(disc.root, resolve(out));
  const target = resolve(roots.output);

  // Commander stores `--no-closure` as `closure: false`; absent keeps closure on.
  const includeClosure = optionState("--closure") !== false;
  const maxBlocks = optionNumber("--max-blocks") ?? DEFAULT_MAX_BLOCKS;
  const requested = optionValue("--programs")?.split(",").map((value) => Number(value.trim())).filter((value) => Number.isInteger(value));

  const extraction = includeClosure ? await extractIgsScenes(disc, { renderAssets: false }) : null;
  const buttonEntries = extraction ? buildButtonPrograms(extraction.scenes) : [];
  const buttonPrograms = buttonEntries.map((entry) => entry.program);
  const buttonRoots = buttonEntries.map((entry) => ({ nodeId: `object:${entry.vmId}`, programId: entry.programId }));
  const graph = buildNavigationGraph(disc.movieObjects, buttonPrograms, { entries: disc.entries });
  const closure = includeClosure ? computeMediaClosure(disc, graph, buttonRoots) : undefined;

  const sources: ViewerProgramSource[] = [
    ...disc.movieObjects.map((program) => ({ program, kind: "movie-object" as const, label: `MOBJ ${program.id}` })),
    ...buttonEntries.map((entry) => ({ program: entry.program, kind: "button-program" as const, label: `Button ${entry.programId}`, streamClipId: entry.streamClipId })),
  ];
  const overviewPrograms: OverviewProgram[] = sources.map((source) => ({
    id: source.program.id, kind: source.kind, label: source.label, instructionCount: source.program.instructions.length,
    ...(source.streamClipId !== undefined ? { streamClipId: source.streamClipId } : {}),
  }));
  const payload = createViewerPayload({ disc, graph, sources, ...(closure ? { closure } : {}), generatedFrom: disc.root });
  const written: string[] = [];

  const transaction = await beginOutputTransaction(roots.output, { overwrite: flagEnabled("--overwrite") });
  try {
    await mkdir(resolve(transaction.stagingPath, "programs"), { recursive: true });
    await writeFile(resolve(transaction.stagingPath, "index.html"), renderGraphViewerHtml(payload), { flag: "wx" });
    await writeFile(resolve(transaction.stagingPath, "graph.json"), `${JSON.stringify(payload, null, 2)}\n`, { flag: "wx" });
    const overview = renderOverviewMermaid({ disc, graph, programs: overviewPrograms, ...(closure ? { closure } : {}) });
    await writeFile(resolve(transaction.stagingPath, "overview.md"), `# bdmv2web navigation overview\n\nDisc: \`${disc.root}\`\n\n\`\`\`mermaid\n${overview}\n\`\`\`\n`, { flag: "wx" });
    written.push("index.html", "graph.json", "overview.md");
    for (const source of sources) {
      if (requested && !requested.includes(source.program.id)) continue;
      const kind = source.kind === "movie-object" ? "mobj" : "button";
      const name = `programs/${kind}-${source.program.id}.md`;
      const diagram = renderProgramFlowchart(source.program, { graph, label: source.label, maxBlocks });
      const text = `# ${source.label}\n\nDisc: \`${disc.root}\` · ${source.program.instructions.length} commands\n\n\`\`\`mermaid\n${diagram}\n\`\`\`\n`;
      await writeFile(resolve(transaction.stagingPath, name), text, { flag: "wx" });
      written.push(name);
    }
    await transaction.commit();
  } catch (error) { await transaction.abort(); throw error; }

  const summary = {
    input: disc.root,
    output: target,
    closure: closure ? { complete: closure.complete, unknown: closure.unknown.length } : null,
    counts: payload.counts,
    files: written,
    truncated: requested ? `program diagrams limited to ${requested.join(", ")}` : null,
  };
  if (outputFormat("visualize") === "json") process.stdout.write(`${JSON.stringify(summary)}\n`);
  else {
    printTable("Navigation graph export", ["Section", "Count / Path"], [
      ["Input", disc.root], ["Output", target],
      ["MovieObjects", payload.counts.movieObjects], ["Button programs", payload.counts.buttonPrograms],
      ["Commands → blocks", `${payload.counts.commands} → ${payload.counts.blocks}`],
      ["Playlists", payload.counts.playlists],
      ["Unresolved edges", payload.counts.unresolvedEdges],
      ["Media closure", closure ? (closure.complete ? "complete" : `${closure.unknown.length} unknown`) : "not computed"],
      ["Viewer", "index.html"], ["Mermaid", `${written.length - 3} program diagrams + overview.md`],
    ]);
  }
}

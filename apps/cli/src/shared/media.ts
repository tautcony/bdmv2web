import { buildNavigationGraph } from "@bdmv2web/hdmv";
import { extractIgsScenes } from "@bdmv2web/igs";
import { computeMediaClosure, createExternalMediaTargets } from "@bdmv2web/media-export";
import type { ParsedDisc } from "@bdmv2web/bdmv-parser";

export function buildMediaClosure(disc: ParsedDisc, scenes: Awaited<ReturnType<typeof extractIgsScenes>>["scenes"]) {
  const programs = scenes.flatMap((scene) => scene.pages.flatMap((page) => page.buttons.filter((button) => button.commands.length).map((button) => ({ scene, button }))));
  const graphs = programs.map(({ scene, button }, id) => buildNavigationGraph([{ id, instructions: button.commands.map((command) => {
    const bytes = Buffer.from(command.bytes); const words: [number, number, number] = [bytes.readUInt32BE(0), bytes.readUInt32BE(4), bytes.readUInt32BE(8)];
    return { bytes: bytes.toString("hex"), words, source: { path: `BDMV/STREAM/${scene.clipId}.m2ts`, origin: "primary" as const, offset: command.sourceOffset } };
  }) }]));
  return computeMediaClosure(disc, buildNavigationGraph(disc.movieObjects, [], { entries: disc.entries }), graphs);
}

export function buildExternalTargets(disc: ParsedDisc, scenes: Awaited<ReturnType<typeof extractIgsScenes>>["scenes"]) {
  return createExternalMediaTargets(disc, buildMediaClosure(disc, scenes));
}

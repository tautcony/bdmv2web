import { buildNavigationGraph, type VmProgram } from "@bdmv2web/hdmv";
import { extractIgsScenes } from "@bdmv2web/igs";
import { computeMediaClosure, createExternalMediaTargets, type MediaClosureButtonRoot } from "@bdmv2web/media-export";
import type { ParsedDisc } from "@bdmv2web/bdmv-parser";

/**
 * Button programs share the MovieObject navigation graph, because `CALL_TITLE`,
 * `JUMP_TITLE` and `*_OBJECT` resolve against that object table. Ids must stay
 * clear of MovieObject numbers so `object:<id>` and `command:<id>:<n>` stay unique.
 */
export const BUTTON_PROGRAM_ID_BASE = 1_000_000;

export function buildMediaClosure(disc: ParsedDisc, scenes: Awaited<ReturnType<typeof extractIgsScenes>>["scenes"]) {
  const programs = scenes.flatMap((scene) => scene.pages.flatMap((page) => page.buttons.filter((button) => button.commands.length).map((button) => ({ scene, button }))));
  const buttonPrograms: VmProgram[] = programs.map(({ scene, button }, programId) => ({ id: BUTTON_PROGRAM_ID_BASE + programId, instructions: button.commands.map((command) => {
    const bytes = Buffer.from(command.bytes); const words: [number, number, number] = [bytes.readUInt32BE(0), bytes.readUInt32BE(4), bytes.readUInt32BE(8)];
    return { bytes: bytes.toString("hex"), words, source: { path: `BDMV/STREAM/${scene.clipId}.m2ts`, origin: "primary" as const, offset: command.sourceOffset } };
  }) }));
  const buttonRoots: MediaClosureButtonRoot[] = buttonPrograms.map((program, programId) => ({ nodeId: `object:${program.id}`, programId }));
  return computeMediaClosure(disc, buildNavigationGraph(disc.movieObjects, buttonPrograms, { entries: disc.entries }), buttonRoots);
}

export function buildExternalTargets(disc: ParsedDisc, scenes: Awaited<ReturnType<typeof extractIgsScenes>>["scenes"]) {
  return createExternalMediaTargets(disc, buildMediaClosure(disc, scenes));
}

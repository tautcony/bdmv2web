import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import { parseBdmv, type ParsedDisc } from "@bdmv2web/bdmv-parser";
import { buildNavigationGraph, decodeInstruction, findStaticNavigationLoops, HdmvVm, type NavigationAction, type StaticNavigationLoop, type TraceEntry } from "@bdmv2web/hdmv";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
const libblurayGoldenPath = resolve(repo, "test-data/baselines/libbluray-1.5.0-navigation-baseline.json");
const corpus = ["tamako", "kyoani-ova", "bang-dream-mygo-vol1", "battle-royale-uhd"] as const;
const MAX_SCENARIOS_PER_CASE = 128;
const MAX_STATES_PER_SCENARIO = 50_000;
let corpusBranchSitesWithBothOutcomes = 0;

afterAll(() => {
  expect(corpusBranchSitesWithBothOutcomes, "DFS corpus observed both outcomes at a branch site").toBeGreaterThan(0);
});

describe("HDMV multi-disc VM execution DFS coverage", () => {
  it.each(corpus)("executes index entries and classifies reachable graph edges for %s", async (caseId) => {
    const bdmvRoot = resolve(repo, `test-data/fixtures/hdmv-navigation/disc-data/${caseId}/BDMV`);
    const disc = await parseBdmv(bdmvRoot);
    const graph = buildNavigationGraph(disc.movieObjects, [], { entries: disc.entries, maxStates: 200_000 });
    const result = exploreDisc(disc, graph);
    const golden = JSON.parse(await readFile(libblurayGoldenPath, "utf8")) as {
      cases: Array<{
        case: string;
        discInfo: { firstPlay: boolean; topMenu: boolean; hdmvTitles: number };
        graph: Array<[string, string | null, string, string]>;
        vmTrace: { playlists: number[] };
      }>;
    };
    const libbluray = golden.cases.find((entry) => entry.case === caseId);
    expect(libbluray, `${caseId} libbluray baseline`).toBeDefined();

    const r = result.report;
    expect(r.entries.length, `${caseId} parsed index entries`).toBe(
      libbluray!.discInfo.hdmvTitles + Number(libbluray!.discInfo.firstPlay) + Number(libbluray!.discInfo.topMenu));
    const libblurayPlayTargets = [...new Set(libbluray!.graph
      .filter((edge) => edge[2] === "play" && edge[1]?.startsWith("playlist:"))
      .map((edge) => Number(edge[1]!.slice("playlist:".length))))].sort((left, right) => left - right);
    expect(r.observedPlaylists, `${caseId} DFS observed every static playlist target from libbluray`)
      .toEqual(expect.arrayContaining(libblurayPlayTargets));
    expect(r.unsupportedEdges, `${caseId} unsupported navigation edges`).toEqual([]);
    expect(r.omittedStaticEdges, `${caseId} resolved static edges without evidence`).toEqual([]);
    expect(r.uncoveredImmediateObjectJumps, `${caseId} immediate JUMP_OBJECT instructions execute their declared target`).toEqual([]);
    expect(r.edgeAccountingComplete, `${caseId} edge accounting`).toBe(true);
    expect(r.budget.exhausted, `${caseId} exploration budget`).toBe(false);
    expect(r.budget.pendingScenarios, `${caseId} pending scenarios`).toEqual([]);
    if (r.conditionalSitesReached > 0) expect(r.branchSitesObserved, `${caseId} observed VM branch outcomes`).toBeGreaterThan(0);
    corpusBranchSitesWithBothOutcomes += r.branchSitesWithBothOutcomes;
  }, 120_000);
});

type EdgeRow = { id: string; status: "covered" | "simulated" | "unavailable" | "unsupported" | "unresolved"; reason?: string };
type RuntimeLoop = { kind: "actual" | "simulated"; entryId: string; firstSeenAt: string; backEdge: { from: string; to: string }; cycle: string[] };
type Report = {
  entries: Array<{ id: string; kind: string; target: string; status: string }>;
  observedPlaylists: number[];
  states: number;
  commandStates: number;
  branchSitesObserved: number;
  branchSitesWithBothOutcomes: number;
  conditionalSitesReached: number;
  graphEdges: number;
  coveredEdges: string[];
  simulatedEdges: string[];
  unavailableEdges: Array<{ edge: string; missingClips: string[] }>;
  unsupportedEdges: Array<{ edge: string; reason: string }>;
  unresolvedEdges: Array<{ edge: string; reason: string }>;
  omittedStaticEdges: string[];
  uncoveredImmediateObjectJumps: string[];
  staticLoops: StaticNavigationLoop[];
  runtimeLoops: RuntimeLoop[];
  edgeAccountingComplete: boolean;
  budget: { exhausted: boolean; scenarios: number; maxScenarios: number; stateCap: number; cycleStatesDeduplicated: number; branchAlternativesQueued: number; pendingScenarios: Array<{ entryId: string; programId: number; decisionCount: number; lastDecisions: string[] }> };
};

function exploreDisc(disc: ParsedDisc, graph: ReturnType<typeof buildNavigationGraph>): { report: Report } {
  const programById = new Map(disc.movieObjects.map((program) => [program.id, program]));
  const decodedInstructions = new WeakMap<object, ReturnType<typeof decodeInstruction>>();
  const decode = (instruction: Parameters<typeof decodeInstruction>[0]) => {
    if (typeof instruction !== "object" || instruction === null) return decodeInstruction(instruction);
    const cached = decodedInstructions.get(instruction);
    if (cached) return cached;
    const decoded = decodeInstruction(instruction);
    decodedInstructions.set(instruction, decoded);
    return decoded;
  };
  const entries = disc.entries.map((entry) => {
    const target = entry.target.objectType === "BDJ" ? `BDJ:${String(entry.target.target)}` : `${entry.target.objectType}:${String(entry.target.target)}`;
    return { id: entry.id, kind: entry.kind, target, entry };
  });
  const roots = entries.filter(({ entry }) => entry.target.objectType === "HDMV" && typeof entry.target.target === "number");
  const entryReports = entries.map(({ id, kind, target, entry }) => ({
    id, kind, target,
    status: entry.target.objectType === "BDJ" ? "unsupported-bdj-entry" : typeof entry.target.target === "number" ? "queued-hdmv-entry" : "unresolved-target",
  }));
  const reachedCommands = new Set<string>();
  const observedTransitions = new Set<string>();
  const observedObjectTransitions = new Set<string>();
  const reachedObjects = new Set<number>();
  const allStates = new Set<string>();
  const unavailablePlaylist = new Map<string, string[]>();
  const unsupportedEdges = new Map<string, string>();
  const unresolvedEdges = new Map<string, string>();
  const runtimeLoops: RuntimeLoop[] = [];
  const branchTargetsByLocation = new Map<string, Set<number>>();
  const branchOutcomesQueued = new Set<string>();
  const attemptedScenarios = new Set<string>();
  const queuedScenarios = new Set<string>();
  const scenarioQueue: Array<{ entryId: string; programId: number; forced: Map<string, number> }> = [];
  let cyclesDeduplicated = 0;
  let stateBudgetExhausted = false;
  const metadataPlaylists = new Map(disc.playlists.map((playlist) => [Number(playlist.id), playlist]));
  const observedPlaylists = new Set<number>();

  const distinctRoots = [...new Map(roots.map(({ entry }) => [entry.target.target as number, entry])).values()];
  for (const entry of distinctRoots) {
    const scenario = { entryId: entry.id, programId: entry.target.target as number, forced: new Map<string, number>() };
    const key = scenarioKey(scenario);
    queuedScenarios.add(key);
    scenarioQueue.push(scenario);
  }

  const signature = (vm: HdmvVm): string => {
    const snap = vm.snapshot();
    const regs: number[] = [];
    for (let i = 0; i < snap.registers.gpr.length; i++) if (snap.registers.gpr[i]) regs.push(i, snap.registers.gpr[i]!);
    for (let i = 0; i < snap.registers.psr.length; i++) if (snap.registers.psr[i]) regs.push(i, snap.registers.psr[i]!);
    return JSON.stringify([snap.programId, snap.pc, regs, snap.callStack, snap.playback, snap.waiting?.type ?? null, snap.status]);
  };

  while (scenarioQueue.length && attemptedScenarios.size < MAX_SCENARIOS_PER_CASE) {
    const scenario = scenarioQueue.shift()!;
    const key = scenarioKey(scenario);
    if (attemptedScenarios.has(key)) continue;
    attemptedScenarios.add(key);
    if (!programById.has(scenario.programId)) { unresolvedEdges.set(`entry:${scenario.entryId}`, `missing HDMV MovieObject ${scenario.programId}`); continue; }

    const traceInstructions: Array<{ id: string; programId: number; pc: number; action?: NavigationAction; simulated: boolean; targetObject?: number; targetPc?: number }> = [];
    const runStateKeys = new Map<string, { location: string; pathIndex: number }>();
    const commandPath: Array<{ id: string; simulated: boolean }> = [];
    const pendingByLocation = new Map<string, string>();
    const pendingAlternates = new Map<string, number>();
    let lastInstruction: { id: string; simulated: boolean; targetObject?: number; targetPc?: number } | null = null;
    let currentSimulated = scenario.forced.size > 0;
    let runStateCount = 0;

    const value = (operand: ReturnType<typeof decodeInstruction>["operands"][number] | null, current: HdmvVm): number => {
      if (!operand) return 0;
      if (operand.kind === "immediate") return operand.value >>> 0;
      if (operand.kind === "gpr" || operand.kind === "psr") return current.registers.read({ kind: operand.kind, index: operand.value }) >>> 0;
      return operand.value >>> 0;
    };
    const comparisonSkip = (opcode: string, a: number, b: number): boolean => {
      if (opcode === "EQ") return a !== b;
      if (opcode === "NE") return a === b;
      if (opcode === "GE") return a < b;
      if (opcode === "GT") return a <= b;
      if (opcode === "LE") return a > b;
      if (opcode === "LT") return a >= b;
      return ((a & (~b >>> 0)) >>> 0) !== 0;
    };
    const nextPcFor = (decoded: ReturnType<typeof decodeInstruction>, current: HdmvVm, pc: number): number => pc + 1 + (comparisonSkip(decoded.opcode ?? "", value(decoded.operands[0], current), value(decoded.operands[1], current)) ? 1 : 0);
    const writeRegister = (operand: NonNullable<ReturnType<typeof decodeInstruction>["operands"][number]>, current: HdmvVm, next: number) => {
      if (operand.kind === "gpr") current.registers.gpr[operand.value] = next >>> 0;
      else if (operand.kind === "psr") current.registers.systemWrite(operand.value, next >>> 0);
    };
    const forceBranch = (decoded: ReturnType<typeof decodeInstruction>, current: HdmvVm, pc: number, desiredPc: number): boolean => {
      const naturalPc = nextPcFor(decoded, current, pc);
      if (naturalPc === desiredPc) return true;
      const a = decoded.operands[0]; const b = decoded.operands[1];
      const currentA = value(a, current); const currentB = value(b, current);
      const candidates = (x: number, y: number): number[] => [...new Set([0, 1, 2, 0xff, 0xffff, 0x7fffffff, 0x80000000, 0xffffffff, y, (y - 1) >>> 0, (y + 1) >>> 0, (y ^ 1) >>> 0, (x - 1) >>> 0, (x + 1) >>> 0, (x ^ 1) >>> 0])];
      for (const [operand, other, left] of [[a, currentB, true], [b, currentA, false]] as const) {
        if (!operand || operand.kind === "immediate") continue;
        const old = value(operand, current);
        for (const candidate of candidates(old, other)) {
          writeRegister(operand, current, candidate);
          const av = left ? candidate : value(a, current);
          const bv = left ? value(b, current) : candidate;
          if (pc + 1 + (comparisonSkip(decoded.opcode ?? "", av, bv) ? 1 : 0) === desiredPc) return true;
        }
        writeRegister(operand, current, old);
      }
      return false;
    };
    const preflight = () => {
      if (vm.status !== "running") return;
      const program = programById.get(vm.programId); const instruction = program?.instructions[vm.pc];
      if (!instruction) return;
      const state = signature(vm);
      const location = `command:${vm.programId}:${vm.pc}`;
      const priorVisit = runStateKeys.get(state);
      if (priorVisit) {
        cyclesDeduplicated++;
        const source = lastInstruction?.id ?? `entry:${scenario.entryId}`;
        const cycle = [...commandPath.slice(priorVisit.pathIndex).map((item) => item.id), location];
        const simulated = currentSimulated || commandPath.slice(priorVisit.pathIndex).some((item) => item.simulated) || !!lastInstruction?.simulated;
        runtimeLoops.push({ kind: simulated ? "simulated" : "actual", entryId: scenario.entryId, firstSeenAt: priorVisit.location, backEdge: { from: source, to: location }, cycle });
        vm.status = "idle"; return;
      }
      if (runStateCount >= MAX_STATES_PER_SCENARIO) { stateBudgetExhausted = true; vm.status = "idle"; return; }
      runStateKeys.set(state, { location, pathIndex: commandPath.length });
      runStateCount++; allStates.add(`${scenario.entryId}|${state}`); reachedObjects.add(vm.programId);
      const decoded = decode(instruction);
      if (!["EQ", "NE", "GE", "GT", "LE", "LT", "BC"].includes(decoded.opcode ?? "")) return;
      const base = `${vm.programId}:${vm.pc}`;
      const branchKey = base;
      pendingByLocation.set(`${vm.programId}:${vm.pc}`, branchKey);
      const desired = scenario.forced.get(branchKey);
      if (desired !== undefined) {
        const forcedApplied = forceBranch(decoded, vm, vm.pc, desired);
        if (!forcedApplied) unresolvedEdges.set(`branch:${branchKey}:${desired}`, "condition outcome could not be forced through writable operands");
      }
    };

    const vm: HdmvVm = new HdmvVm(disc.movieObjects, { entries: disc.entries, maxInstructionsPerTurn: MAX_STATES_PER_SCENARIO, onTrace: (entry: TraceEntry) => {
      if (entry.raw) {
        const id = `command:${entry.programId}:${entry.pc}`;
        commandPath.push({ id, simulated: currentSimulated });
        reachedCommands.add(id);
        if (lastInstruction) {
          const basis = lastInstruction.simulated || currentSimulated ? "simulated" : "actual";
          observedTransitions.add(`${lastInstruction.id}->${id}:${basis}`);
          const fromProgram = Number(lastInstruction.id.split(":")[1]);
          if (fromProgram !== entry.programId) observedObjectTransitions.add(`${lastInstruction.id}->object:${entry.programId}:${basis}`);
          if (lastInstruction.targetObject === entry.programId && lastInstruction.targetPc === entry.pc) {
            observedObjectTransitions.add(`${lastInstruction.id}->object:${entry.programId}:${basis}`);
          }
        }
        const sourceInstruction = programById.get(entry.programId)?.instructions[entry.pc];
        const decoded = sourceInstruction ? decode(sourceInstruction) : decode(entry.raw);
        let targetObject: number | undefined;
        let targetPc: number | undefined;
        if (["JUMP_OBJECT", "CALL_OBJECT"].includes(decoded.opcode ?? "")) {
          targetObject = value(decoded.operands[0], vm);
          targetPc = 0;
        } else if (["JUMP_TITLE", "CALL_TITLE"].includes(decoded.opcode ?? "")) {
          const title = value(decoded.operands[0], vm);
          const targetEntry = title === 0 ? disc.entries.find((item) => item.kind === "topMenu")
            : title === 0xffff ? disc.entries.find((item) => item.kind === "firstPlay")
              : title > 0 ? disc.entries.filter((item) => item.kind === "title")[title - 1] : undefined;
          if (targetEntry?.target.objectType === "HDMV" && typeof targetEntry.target.target === "number") {
            targetObject = targetEntry.target.target;
            targetPc = 0;
          }
        }
        if (targetObject !== undefined && vm.programId === targetObject && vm.pc === targetPc) {
          observedObjectTransitions.add(`${id}->object:${targetObject}:${currentSimulated ? "simulated" : "actual"}`);
        }
        traceInstructions.push({ id, programId: entry.programId, pc: entry.pc, ...(entry.action ? { action: entry.action } : {}), simulated: currentSimulated, ...(targetObject === undefined || targetPc === undefined ? {} : { targetObject, targetPc }) });
        const branchKey = pendingByLocation.get(`${entry.programId}:${entry.pc}`);
        if (branchKey && ["EQ", "NE", "GE", "GT", "LE", "LT", "BC"].includes(decoded.opcode ?? "")) {
          const targetPc = vm.programId === entry.programId ? vm.pc : -1;
          const locationOutcomes = branchTargetsByLocation.get(`${entry.programId}:${entry.pc}`) ?? new Set<number>();
          locationOutcomes.add(targetPc); branchTargetsByLocation.set(`${entry.programId}:${entry.pc}`, locationOutcomes);
          const instruction = programById.get(entry.programId)?.instructions[entry.pc];
          const length = programById.get(entry.programId)?.instructions.length ?? 0;
          const locationKey = `${entry.programId}:${entry.pc}`;
          const alternate = targetPc === entry.pc + 1 ? entry.pc + 2 : entry.pc + 1;
          // Queue only a branch outcome that has not already been observed by a VM execution.
          if (!scenario.forced.has(locationKey) && !branchTargetsByLocation.get(locationKey)?.has(alternate)) {
            if (alternate <= length) pendingAlternates.set(locationKey, alternate);
            else unresolvedEdges.set(`branch:${branchKey}`, "alternate condition target exceeds the current object instruction range");
          }
          if (!instruction || targetPc < 0) unresolvedEdges.set(`branch:${branchKey}`, "VM control transfer did not expose a same-object next PC");
        }
        pendingByLocation.delete(`${entry.programId}:${entry.pc}`);
        lastInstruction = { id, simulated: currentSimulated, ...(targetObject === undefined || targetPc === undefined ? {} : { targetObject, targetPc }) };
      }
      preflight();
    } });
    vm.reset(scenario.programId);
    preflight();
    const pendingActions: NavigationAction[] = [];
    let turns = 0;
    while (turns++ < 256 && !["faulted", "stopped"].includes(vm.snapshot().status)) {
      if (vm.status === "idle" || vm.status === "running") vm.runTurn();
      pendingActions.push(...vm.drainActions());
      if (!pendingActions.length) {
        if (vm.status === "idle" || vm.status === "stopped" || vm.status === "faulted") break;
        if (vm.status === "suspended" && vm.snapshot().waiting) pendingActions.push(vm.snapshot().waiting!);
        else break;
      }
      while (pendingActions.length) {
        const action = pendingActions.shift()!;
        const sourceTrace = [...vm.trace].reverse().find((item) => item.action?.id === action.id || item.source?.path === action.source.path && item.source.offset === action.source.offset);
        const sourceId = sourceTrace ? `command:${sourceTrace.programId}:${sourceTrace.pc}` : `command:${vm.programId}:${vm.pc}`;
        const sourceInstruction = sourceTrace ? programById.get(sourceTrace.programId)?.instructions[sourceTrace.pc] : undefined;
        const decodedSource = sourceInstruction ? decode(sourceInstruction) : null;
        if (["PLAY_PLAYLIST", "PLAY_PLAYLIST_ITEM", "PLAY_PLAYLIST_MARK"].includes(action.type)) {
          const playlistNumber = Number(action.payload.playlist);
          observedPlaylists.add(playlistNumber);
          const playlist = metadataPlaylists.get(playlistNumber);
          if (!playlist) unresolvedEdges.set(sourceId, `action targets missing playlist ${playlistNumber}`);
          else {
            const clipIds = [...new Set([...playlist.playItems.map((item) => item.clipId), ...playlist.subPaths.flatMap((subPath) => subPath.items.map((item) => item.clipId))])];
            const missing = clipIds.filter((clipId) => disc.graph.nodes.find((node) => node.id === `clip:${clipId}`)?.state !== "present");
            if (missing.length) unavailablePlaylist.set(sourceId, missing);
          }
          if (action.waitFor) {
            // Media completion is simulated only to explore the VM continuation. The edge stays unavailable when source STREAM is absent.
            currentSimulated = true;
            vm.handleEvent({ type: "MEDIA_ENDED", generation: action.generation, responseTo: action.id });
            pendingActions.push(...vm.drainActions());
          }
        } else if (action.type === "TITLE_SEARCH") {
          const title = Number(action.payload.title);
          const targetEntry = title === 0 ? disc.entries.find((entry) => entry.kind === "topMenu")
            : title === 0xffff ? disc.entries.find((entry) => entry.kind === "firstPlay")
              : title > 0 ? disc.entries.filter((entry) => entry.kind === "title")[title - 1] : undefined;
          if (!targetEntry || targetEntry.target.objectType === "BDJ") unsupportedEdges.set(sourceId, targetEntry?.target.objectType === "BDJ" ? "title resolves to BD-J, not executable HDMV" : `title ${title} has no index entry`);
          else {
            if (decodedSource?.operands[0]?.kind !== "immediate") unresolvedEdges.set(sourceId, "dynamic title operand; only observed runtime value was followed");
            const selected = vm.selectTitle(title);
            if (targetEntry.target.objectType === "HDMV" && typeof targetEntry.target.target === "number" && selected.programId === targetEntry.target.target) {
              observedObjectTransitions.add(`${sourceId}->object:${targetEntry.target.target}:${currentSimulated ? "simulated" : "actual"}`);
            }
            pendingActions.push(...vm.drainActions());
          }
        } else if (action.waitFor) {
          unresolvedEdges.set(sourceId, `external ${action.type} wait is not a media-play edge`);
          const eventType = action.waitFor === "started" ? "MEDIA_STARTED" : action.waitFor === "seeked" ? "MEDIA_SEEKED" : action.waitFor === "still-completed" ? "STILL_COMPLETED" : "MEDIA_ENDED";
          currentSimulated = true;
          vm.handleEvent({ type: eventType, generation: action.generation, responseTo: action.id });
          pendingActions.push(...vm.drainActions());
        }
      }
      if (vm.status === "idle" && !vm.drainActions().length) break;
    }
    if (turns >= 256 || vm.diagnostic?.code === "VM_EXECUTION_LIMIT") stateBudgetExhausted = true;
    for (let i = 1; i < traceInstructions.length; i++) {
      const previous = traceInstructions[i - 1]!; const current = traceInstructions[i]!;
      const basis = previous.simulated || current.simulated ? "simulated" : "actual";
      observedTransitions.add(`${previous.id}->${current.id}:${basis}`);
      const previousDecoded = decode(programById.get(previous.programId)!.instructions[previous.pc]!);
      if (["EQ", "NE", "GE", "GT", "LE", "LT", "BC"].includes(previousDecoded.opcode ?? "") && current.programId === previous.programId) {
        const outcomes = branchTargetsByLocation.get(`${previous.programId}:${previous.pc}`) ?? new Set<number>();
        outcomes.add(current.pc); branchTargetsByLocation.set(`${previous.programId}:${previous.pc}`, outcomes);
      }
      if (previous.targetObject === current.programId && previous.targetPc === current.pc) observedObjectTransitions.add(`${previous.id}->object:${current.programId}:${basis}`);
    }
    if (pendingAlternates.size > 0) {
      const forced = new Map(scenario.forced);
      for (const [site, target] of pendingAlternates) {
        forced.set(site, target);
        branchOutcomesQueued.add(`${site}->${target}`);
      }
      const nextScenario = { entryId: scenario.entryId, programId: scenario.programId, forced };
      const nextKey = scenarioKey(nextScenario);
      if (!attemptedScenarios.has(nextKey) && !queuedScenarios.has(nextKey)) {
        queuedScenarios.add(nextKey);
        scenarioQueue.push(nextScenario);
      }
    }
  }

  const scenarioBudgetExhausted = scenarioQueue.length > 0;
  const edgeRows: EdgeRow[] = [];
  const conditionalCommandIds = new Set<string>();
  for (const commandId of reachedCommands) {
    const [, programText, pcText] = commandId.split(":");
    const instruction = programById.get(Number(programText))?.instructions[Number(pcText)];
    if (instruction && ["EQ", "NE", "GE", "GT", "LE", "LT", "BC"].includes(decode(instruction).opcode ?? "")) conditionalCommandIds.add(commandId);
  }
  let conditionalShadowEdges = 0;
  for (const edge of graph.edges) {
    if (!reachedCommands.has(edge.from)) continue;
    if (edge.kind === "sequence" && conditionalCommandIds.has(edge.from)) { conditionalShadowEdges++; continue; }
    const id = `${edge.from}->${edge.to ?? "?"}:${edge.kind}`;
    const transitions = [`${edge.from}->${edge.to}:actual`, `${edge.from}->${edge.to}:simulated`];
    if (edge.to?.startsWith("object:")) {
      const targetId = Number(edge.to.slice("object:".length));
      if (observedObjectTransitions.has(`${edge.from}->object:${targetId}:actual`) || observedObjectTransitions.has(`${edge.from}->object:${targetId}:simulated`)) {
        edgeRows.push({ id, status: observedObjectTransitions.has(`${edge.from}->object:${targetId}:simulated`) ? "simulated" : "covered" }); continue;
      }
    }
    if (edge.to && transitions.some((transition) => observedTransitions.has(transition))) { edgeRows.push({ id, status: observedTransitions.has(transitions[0]!) ? "covered" : "simulated" }); continue; }
    if (edge.kind === "sequence" && edge.condition === "after playlist returns" && unavailablePlaylist.has(edge.from)) {
      edgeRows.push({ id, status: "unavailable", reason: `continuation depends on unavailable media clips: ${unavailablePlaylist.get(edge.from)!.join(",")}` });
      continue;
    }
    if (edge.kind === "sequence" && edge.condition === "after playlist returns" && metadataPlaylists.size > 0) {
      edgeRows.push({ id, status: "simulated", reason: "playlist completion event is simulated by the headless playback bridge" });
      continue;
    }
    if (edge.kind === "sequence" && edge.condition === "after title resumes") {
      edgeRows.push({ id, status: "unresolved", reason: "unresolved-call-return-context: target may not return through RESUME on the observed path" });
      continue;
    }
    if (edge.to?.startsWith("playlist:")) {
      const playlistNumber = Number(edge.to.slice("playlist:".length));
      const source = edge.from;
      const missing = unavailablePlaylist.get(source);
      if (missing) edgeRows.push({ id, status: "unavailable", reason: `missing STREAM clips: ${missing.join(",")}` });
      else if (metadataPlaylists.has(playlistNumber)) edgeRows.push({ id, status: "simulated", reason: "metadata playlist resolved; playback completion is simulated" });
      else edgeRows.push({ id, status: "unresolved", reason: `playlist ${playlistNumber} is not present in parsed metadata` });
      continue;
    }
    if (edge.resolution === "unresolved") {
      const reason = unsupportedEdges.get(edge.from) ?? unresolvedEdges.get(edge.from) ?? (edge.kind === "conditional" ? "alternate conditional outcome was not observed within DFS budget" : edge.kind === "resume" ? "RESUME destination depends on runtime call context" : "dynamic or non-index navigation target");
      const status = unsupportedEdges.has(edge.from) ? "unsupported" : "unresolved";
      edgeRows.push({ id, status, reason });
      continue;
    }
    if (unsupportedEdges.has(edge.from)) { edgeRows.push({ id, status: "unsupported", reason: unsupportedEdges.get(edge.from)! }); continue; }
    if (unavailablePlaylist.has(edge.from)) { edgeRows.push({ id, status: "unavailable", reason: `missing STREAM clips: ${unavailablePlaylist.get(edge.from)!.join(",")}` }); continue; }
    edgeRows.push({ id, status: "unresolved", reason: unresolvedEdges.get(edge.from) ?? "resolved graph edge was not observed by VM trace" });
  }
  const omittedStaticEdges = edgeRows.filter((edge) => edge.status === "unresolved" && !edge.reason?.startsWith("unresolved-call-return-context:") && graph.edges.some((candidate) => `${candidate.from}->${candidate.to ?? "?"}:${candidate.kind}` === edge.id && candidate.resolution === "resolved")).map((edge) => edge.id);
  const uncoveredImmediateObjectJumps = graph.edges.filter((edge) => {
    if (edge.kind !== "jump" || !edge.from.startsWith("command:") || !reachedCommands.has(edge.from)) return false;
    const [, objectText, pcText] = edge.from.split(":");
    const instruction = programById.get(Number(objectText))?.instructions[Number(pcText)];
    if (!instruction) return false;
    const decoded = decode(instruction);
    return decoded.opcode === "JUMP_OBJECT" && decoded.operands[0]?.kind === "immediate";
  }).filter((edge) => {
    const id = `${edge.from}->${edge.to ?? "?"}:${edge.kind}`;
    return !edgeRows.some((row) => row.id === id && (row.status === "covered" || row.status === "simulated"));
  }).map((edge) => `${edge.from}->${edge.to ?? "?"}:${edge.kind}`);
  const report: Report = {
    entries: entryReports.map((entry) => {
      const root = roots.find(({ entry: source }) => source.id === entry.id)?.entry;
      if (entry.status === "queued-hdmv-entry" && root && typeof root.target.target === "number" && reachedObjects.has(root.target.target)) return { ...entry, status: "executed-hdmv-entry" };
      return entry;
    }),
    observedPlaylists: [...observedPlaylists].sort((left, right) => left - right),
    states: allStates.size,
    commandStates: reachedCommands.size,
    branchSitesObserved: [...branchTargetsByLocation.values()].filter((outcomes) => outcomes.size > 0).length,
    branchSitesWithBothOutcomes: [...branchTargetsByLocation.entries()].filter(([location, outcomes]) => {
      const pc = Number(location.split(":")[1]);
      return outcomes.has(pc + 1) && outcomes.has(pc + 2);
    }).length,
    conditionalSitesReached: conditionalCommandIds.size,
    graphEdges: edgeRows.length + conditionalShadowEdges,
    coveredEdges: edgeRows.filter((edge) => edge.status === "covered").map((edge) => edge.id),
    simulatedEdges: edgeRows.filter((edge) => edge.status === "simulated").map((edge) => edge.id),
    unavailableEdges: edgeRows.filter((edge) => edge.status === "unavailable").map((edge) => ({ edge: edge.id, missingClips: edge.reason?.replace("missing STREAM clips: ", "").split(",") ?? [] })),
    unsupportedEdges: edgeRows.filter((edge) => edge.status === "unsupported").map((edge) => ({ edge: edge.id, reason: edge.reason ?? "unsupported" })),
    unresolvedEdges: edgeRows.filter((edge) => edge.status === "unresolved").map((edge) => ({ edge: edge.id, reason: edge.reason ?? "unresolved" })),
    omittedStaticEdges,
    uncoveredImmediateObjectJumps,
    staticLoops: findStaticNavigationLoops(graph),
    runtimeLoops,
    edgeAccountingComplete: edgeRows.length + conditionalShadowEdges === graph.edges.filter((edge) => reachedCommands.has(edge.from)).length && edgeRows.every((edge) => ["covered", "simulated", "unavailable", "unsupported", "unresolved"].includes(edge.status)),
    budget: {
      exhausted: scenarioBudgetExhausted || stateBudgetExhausted || !graph.complete,
      scenarios: attemptedScenarios.size,
      maxScenarios: MAX_SCENARIOS_PER_CASE,
      stateCap: MAX_STATES_PER_SCENARIO,
      cycleStatesDeduplicated: cyclesDeduplicated,
      branchAlternativesQueued: branchOutcomesQueued.size,
      pendingScenarios: scenarioQueue.slice(0, 8).map((scenario) => ({ entryId: scenario.entryId, programId: scenario.programId, decisionCount: scenario.forced.size, lastDecisions: [...scenario.forced].slice(-4).map(([site, target]) => `${site}->${target}`) })),
    },
  };
  return { report };
}

function scenarioKey(scenario: { entryId: string; programId: number; forced: Map<string, number> }): string {
  return `${scenario.entryId}|${scenario.programId}|${[...scenario.forced].sort(([a], [b]) => a.localeCompare(b)).map(([key, value]) => `${key}=${value}`).join(";")}`;
}

import { describe, expect, it } from "vitest";
import { DEFAULT_LIMITS, validateLimits } from "@bdmv2web/core";
import { buildNavigationGraph, decodeInstruction, disassemble, HdmvVm, m3Fixtures, M3_FIXTURE_IDS, RegisterFile } from "./index.js";

function rawCommand(w0: number, w1 = 0, w2 = 0): string {
  return [w0, w1, w2].map((word) => (word >>> 0).toString(16).padStart(8, "0")).join("");
}

describe("M3 HDMV fixtures", () => {
  it("uses shared defaults and accepts the shared Limits object", () => {
    const defaults = new HdmvVm([]);
    expect(defaults.limits).toEqual(DEFAULT_LIMITS);
    expect(defaults.trace[0]?.limits).toEqual(DEFAULT_LIMITS);

    const scalar = new HdmvVm([], { maxInstructionsPerTurn: 17, maxCallDepth: 0, maxQueueDepth: 3 });
    expect(scalar.limits).toMatchObject({ maxInstructionsPerTurn: 17, maxCallDepth: 0, maxQueueDepth: 3 });

    const limits = validateLimits({ maxInstructionsPerTurn: 23, maxCallDepth: 0, maxQueueDepth: 4 });
    const configured = new HdmvVm([], { limits });
    expect(configured.limits).toEqual(limits);
    expect(configured.trace[0]?.limits).toEqual(limits);

    const both = new HdmvVm([], { limits, maxInstructionsPerTurn: 99 });
    expect(both.limits.maxInstructionsPerTurn).toBe(23);
    expect(both.diagnostics.filter((item) => item.code === "VM_LIMITS_OVERRIDDEN")).toHaveLength(1);
    expect(both.trace.some((entry) => entry.diagnostic?.code === "VM_LIMITS_OVERRIDDEN")).toBe(true);
  });
  it("keeps the default VM budgets aligned with DEFAULT_LIMITS", () => {
    const vm = new HdmvVm([]);
    expect(vm.limits.maxCallDepth).toBe(DEFAULT_LIMITS.maxCallDepth);
    expect(vm.limits.maxQueueDepth).toBe(DEFAULT_LIMITS.maxQueueDepth);
    expect(vm.limits.maxInstructionsPerTurn).toBe(DEFAULT_LIMITS.maxInstructionsPerTurn);
  });
  it("decodes the shared 12-byte MOBJ/button representation and preserves source/raw", () => {
    const decoded = decodeInstruction(m3Fixtures.move5);
    expect(decoded.bytes).toBe(m3Fixtures.move5.bytes); expect(decoded.words).toEqual(m3Fixtures.move5.words);
    expect(decoded.source).toEqual(m3Fixtures.move5.source); expect(decoded.opcode).toBe("MOVE");
    expect(disassemble(m3Fixtures.move5)).toBe("MOVE GPR[0], IMMEDIATE[5]");
    expect(decodeInstruction(Uint8Array.from(m3Fixtures.move5.bytes.match(/../g)!, (x) => Number.parseInt(x, 16)), m3Fixtures.move5.source)).toEqual(decoded);
    const buttonSource = { ...m3Fixtures.move5.source, path: "M3-test/button.bin", offset: "256" };
    const buttonDecoded = decodeInstruction({ ...m3Fixtures.move5, source: buttonSource });
    expect(buttonDecoded.opcode).toBe(decoded.opcode); expect(buttonDecoded.operands).toEqual(decoded.operands); expect(buttonDecoded.source).toEqual(buttonSource);
  });
  it("runs uint32 register arithmetic and records deltas", () => {
    const vm = new HdmvVm([{ id: 0, instructions: [m3Fixtures.move5, m3Fixtures.add7, m3Fixtures.break] }]);
    const state = vm.runTurn(); expect(state.registers.gpr[0]).toBe(12); expect(state.status).toBe("idle");
    expect(vm.trace.flatMap((x) => Object.entries(x.registerDelta.gpr))).toContainEqual(["0", 12]);
    expect(vm.trace.find((x) => x.decoded?.startsWith("MOVE"))?.pc).toBe(0);
  });
  it("uses the pinned libbluray LCG sequence for RND and restores it with checkpoints", () => {
    const rnd = rawCommand(0x50400008, 0, 5);
    const vm = new HdmvVm([{ id: 0, instructions: [rnd, rnd, rnd, m3Fixtures.break] }], { randomSeed: 1 });
    vm.runTurn();
    const outputs = vm.trace.filter((entry) => entry.decoded?.startsWith("RND")).map((entry) => entry.registerDelta.gpr[0]);
    expect(outputs).toEqual([4, 2, 1]);

    vm.reset();
    vm.runTurn();
    expect(vm.trace.filter((entry) => entry.decoded?.startsWith("RND")).slice(-3).map((entry) => entry.registerDelta.gpr[0])).toEqual([4, 2, 1]);

    const checkpointVm = new HdmvVm([{ id: 0, instructions: [rnd, rnd, rnd, m3Fixtures.break] }], { randomSeed: 1 });
    checkpointVm.runTurn();
    const checkpoint = checkpointVm.saveCheckpoint();
    checkpointVm.reset();
    checkpointVm.restoreCheckpoint(checkpoint);
    expect(checkpointVm.snapshot()).toEqual(expect.objectContaining({ status: "idle" }));
    expect(checkpointVm.trace.filter((entry) => entry.decoded?.startsWith("RND")).map((entry) => entry.registerDelta.gpr[0])).toEqual([4, 2, 1]);

    const overrideVm = new HdmvVm([{ id: 0, instructions: [rnd, rnd, rnd, m3Fixtures.break] }], { randomSeed: 1 });
    overrideVm.reset(0, undefined, 7); overrideVm.runTurn();
    const seedSeven = overrideVm.trace.filter((entry) => entry.decoded?.startsWith("RND")).slice(-3).map((entry) => entry.registerDelta.gpr[0]);
    overrideVm.reset(); overrideVm.runTurn();
    expect(overrideVm.trace.filter((entry) => entry.decoded?.startsWith("RND")).slice(-3).map((entry) => entry.registerDelta.gpr[0])).toEqual(seedSeven);
  });
  it("returns one and records the reference diagnostic for a zero RND range", () => {
    const vm = new HdmvVm([{ id: 0, instructions: [rawCommand(0x50400008, 0, 0), m3Fixtures.break] }]);
    const result = vm.runTurn();
    expect(result.status).toBe("idle");
    expect(result.registers.gpr[0]).toBe(1);
    expect(vm.diagnostics.map((diagnostic) => diagnostic.code)).toContain("HDMV_RND_ZERO_RANGE");
  });
  it("restores VM execution state and history from a checkpoint", () => {
    const vm = new HdmvVm([{ id: 0, instructions: [m3Fixtures.move5] }]);
    vm.runTurn();
    const checkpoint = vm.saveCheckpoint();
    const snapshot = vm.snapshot();
    const trace = structuredClone(vm.trace);

    vm.registers.write({ kind: "gpr", index: 0 }, 99);
    vm.handleEvent({ type: "MENU_INPUT", input: "right", channel: "keyboard" });
    expect(vm.snapshot()).not.toEqual(snapshot);
    vm.restoreCheckpoint(checkpoint);

    expect(vm.snapshot()).toEqual(snapshot);
    expect(vm.trace).toEqual(trace);
    vm.registers.write({ kind: "gpr", index: 0 }, 12);
    vm.restoreCheckpoint(checkpoint);
    expect(vm.snapshot()).toEqual(snapshot);
  });
  it("keeps unsupported semantics diagnostic and continues the current object", () => {
    const observed: Array<{ decoded: string | null; status: string; diagnostic?: { code: string } }> = [];
    const vm = new HdmvVm([{ id: 0, instructions: [rawCommand(0x21830000, 1), m3Fixtures.move5] }], {
      onTrace: (entry) => observed.push(entry),
    });
    const initial = vm.runTurn();
    expect(initial).toMatchObject({ status: "idle", pc: 2, diagnostic: { code: "HDMV_UNVERIFIED_OPCODE" } });
    expect(initial.registers.gpr[0]).toBe(5);

    const result = vm.executeButtonProgram([m3Fixtures.move5], "ig_object");
    expect(result).toMatchObject({ status: "running", fault: null, registers: { gpr: expect.arrayContaining([5]) } });
    expect(result.diagnostic?.code).toBe("HDMV_UNVERIFIED_OPCODE");
    expect(observed.some((entry) => entry.diagnostic?.code === "HDMV_UNVERIFIED_OPCODE" && entry.status === "running")).toBe(true);
    expect(observed.some((entry) => entry.decoded?.startsWith("MOVE") && entry.status === "running")).toBe(true);
  });
  it("executes a raw button command in the current VM context with its own source", () => {
    const vm = new HdmvVm([{ id: 0, instructions: [m3Fixtures.break] }]);
    const source = { path: "BDMV/PLAYLIST/00001.mpls", origin: "primary" as const, offset: "0x2a0" };
    const bytes = Uint8Array.from(m3Fixtures.move5.bytes.match(/../g)!, (x) => Number.parseInt(x, 16));
    const state = vm.executeButtonCommand(bytes, source);
    expect(state.registers.gpr[0]).toBe(5);
    expect(state.programId).toBe(0); expect(state.pc).toBe(0);
    expect(vm.trace.at(-1)).toMatchObject({ programId: 0, pc: 0, raw: m3Fixtures.move5.bytes, decoded: "MOVE gpr[0],#5", source, registerDelta: { gpr: { 0: 5 }, psr: {} } });
  });
  it("applies immediate SET_STREAM selections to PSRs and emits resolved playback fields", () => {
    const words: [number, number, number] = [0x51c00001, 0x80030000, 0x80048007];
    const bytes = words.map((word) => word.toString(16).padStart(8, "0")).join("");
    const vm = new HdmvVm([{ id: 0, instructions: [bytes, m3Fixtures.break] }]);
    const state = vm.runTurn(); const action = vm.actions[0]!;
    expect(state.registers.psr[1]).toBe(3); expect(state.registers.psr[0]).toBe(4); expect(state.registers.psr[3]).toBe(7);
    expect(action).toMatchObject({ type: "SET_STREAM", payload: {
      destinationRaw: 0x80030000, sourceRaw: 0x80048007,
      destinationValue: 0x80030000, sourceValue: 0x80048007,
      primaryAudioStream: 3, interactiveGraphicsStream: 4, angle: 7, pgSubtitleStream: null, pgSubtitleDisplay: false,
    } });
    expect(action).not.toHaveProperty("waitFor");
    expect(vm.trace.find((entry) => entry.decoded?.startsWith("SET_STREAM"))?.registerDelta.psr).toEqual({ 0: 4, 1: 3, 3: 7 });
  });
  it("leaves stream PSRs unchanged when the matching SET_STREAM flags are clear", () => {
    const words: [number, number, number] = [0x51c00001, 1, 2];
    const bytes = words.map((word) => word.toString(16).padStart(8, "0")).join("");
    const vm = new HdmvVm([{ id: 0, instructions: [bytes, m3Fixtures.break] }]);
    const before = [vm.registers.psr[0], vm.registers.psr[1], vm.registers.psr[3]];
    const state = vm.runTurn();
    expect([state.registers.psr[0], state.registers.psr[1], state.registers.psr[3]]).toEqual(before);
    expect(vm.actions[0]).toMatchObject({ type: "SET_STREAM", payload: {
      primaryAudioStream: null, interactiveGraphicsStream: null, angle: null, pgSubtitleStream: null, pgSubtitleDisplay: false,
    } });
  });
  it("updates the PG subtitle stream and display flag in PSR2 from SET_STREAM", () => {
    const selectAndDisplay = new HdmvVm([{ id: 0, instructions: [rawCommand(0x51c00001, 0x8003c321, 0), m3Fixtures.break] }]);
    const selected = selectAndDisplay.runTurn();
    expect(selected.registers.psr[2]).toBe(0x8fff0321);
    expect(selectAndDisplay.actions[0]?.payload).toMatchObject({ primaryAudioStream: 3, pgSubtitleStream: 0x321, pgSubtitleDisplay: true });
    const hide = new HdmvVm([{ id: 0, instructions: [rawCommand(0x51c00001, 0x80000000, 0), m3Fixtures.break] }]);
    hide.registers.systemWrite(2, 0xffffffff);
    expect(hide.runTurn().registers.psr[2]).toBe(0x7fffffff);
  });
  it("resolves SET_SEC_STREAM, updates PSR14/PSR2, and emits mapped fields", () => {
    const vm = new HdmvVm([{ id: 0, instructions: [rawCommand(0x51c00006, 0xc1850005, 0xc003e007), m3Fixtures.break] }]);
    const state = vm.runTurn();
    expect(state.registers.psr[14]).toBe(0xc5000503);
    expect(state.registers.psr[2]).toBe(0xc0070fff);
    expect(vm.actions[0]).toMatchObject({ type: "SET_SECONDARY_STREAM", payload: {
      secondaryVideoStream: 5, secondaryVideoSize: 5, secondaryAudioStream: 3,
      displayVideo: true, displayAudio: true, pipPgStream: 7, textSubtitleFlags: 3,
    } });
    expect(vm.actions[0]).not.toHaveProperty("waitFor");
  });
  it("resolves GPR encoded SET_SEC_STREAM operands", () => {
    const vm = new HdmvVm([{ id: 0, instructions: [rawCommand(0x51000006, 0xc000f000, 0xc000f000), m3Fixtures.break] }]);
    vm.registers.write({ kind: "gpr", index: 0 }, 0x85);
    const state = vm.runTurn();
    expect(state.registers.psr[14]).toBe(0xc5008585);
    expect(state.registers.psr[2]).toBe(0xc0850fff);
    expect(vm.actions[0]?.payload.destinationValue).toBe(0xc085f085);
    expect(vm.actions[0]?.payload.sourceValue).toBe(0xc085f085);
  });
  it("resolves page 3 button 1 SET_STREAM GPR selectors in MovieObject and IG-button contexts", () => {
    // Raw commands from BDMV/STREAM/00005.m2ts, IGS page 3, button 1 (orders 12 and 14).
    const movieObjectCommand = "510000018feb8fec00000000";
    const igButtonCommand = "510000018febcfec00000000";
    const movieObjectVm = new HdmvVm([{ id: 0, instructions: [movieObjectCommand, m3Fixtures.break] }]);
    movieObjectVm.registers.write({ kind: "gpr", index: 0xfeb }, 2);
    movieObjectVm.registers.write({ kind: "gpr", index: 0xfec }, 1);
    const movieObjectState = movieObjectVm.runTurn();
    expect(movieObjectState.registers.psr[1]).toBe(2);
    expect(movieObjectVm.actions[0]).toMatchObject({ type: "SET_STREAM", payload: {
      destinationRaw: 0x8feb8fec, destinationValue: 0x80028001, primaryAudioStream: 2,
      interactiveGraphicsStream: null, angle: null,
    } });

    const igButtonVm = new HdmvVm([{ id: 0, instructions: [m3Fixtures.break] }]);
    igButtonVm.registers.write({ kind: "gpr", index: 0xfeb }, 2);
    igButtonVm.registers.write({ kind: "gpr", index: 0xfec }, 1);
    const igButtonState = igButtonVm.executeButtonCommand(igButtonCommand, undefined, "ig_object");
    expect(igButtonState.registers.psr[1]).toBe(2);
    expect(igButtonVm.actions[0]).toMatchObject({ type: "SET_STREAM", payload: {
      destinationRaw: 0x8febcfec, destinationValue: 0x8002c001, primaryAudioStream: 2,
      interactiveGraphicsStream: null, angle: null,
    } });
  });
  it("executes button GOTO and comparison branches with a sequence-local PC", () => {
    const make = (words: [number, number, number]) => { const normalized = words.map((word) => word >>> 0) as [number, number, number]; return { words: normalized, bytes: normalized.map((word) => word.toString(16).padStart(8, "0")).join(""), source: m3Fixtures.move5.source }; };
    const eqOne = make([m3Fixtures.compareEq7.words[0], 0, 1]);
    const setAudio = (track: number) => make([0x51c00001, 0x80000000 | (track << 16), 0]);
    const gotoEnd = make([m3Fixtures.goto0.words[0], 4, 0]);
    const commands = [eqOne, setAudio(2), gotoEnd, setAudio(3), m3Fixtures.break];

    const chosen = new HdmvVm([{ id: 0, instructions: [m3Fixtures.break] }]);
    chosen.registers.write({ kind: "gpr", index: 0 }, 1);
    const chosenResult = chosen.executeButtonProgram(commands, "ig_object");
    expect(chosenResult.fault).toBeNull(); expect(chosenResult.terminated).toBe(true);
    expect(chosenResult.pc).toBe(0); expect(chosenResult.registers.psr[1]).toBe(2);
    expect(chosenResult.actions.filter((action) => action.type === "SET_STREAM")).toHaveLength(1);
    expect(chosenResult.actions[0]?.payload.primaryAudioStream).toBe(2);

    const skipped = new HdmvVm([{ id: 0, instructions: [m3Fixtures.break] }]);
    const skippedResult = skipped.executeButtonProgram(commands, "ig_object");
    expect(skippedResult.terminated).toBe(true); expect(skippedResult.actions.filter((action) => action.type === "SET_STREAM")).toHaveLength(0);
    expect(skippedResult.registers.psr[1]).toBe(0xff);
  });
  it("runs only the reached SET_STREAM branch in the real page 3 button 1 command list", () => {
    // All 19 raw commands from IGS page 3/button 1 in BDMV/STREAM/00005.m2ts.
    const commands = [
      "5040000100000feb00000000", "5000000100000de500000feb", "5040000100000feb00000001",
      "5040000100000fec00000001", "5000000100000fed00000a29", "5000000100000fee00000a29",
      "5040000100000fef00000001", "5000000900000fef00000a28", "5040000f00000fef00000000",
      "4840020000000fef00000000", "208100000000000c00000000", "208100000000000e00000000",
      "510000018feb8fec00000000", "208100000000000f00000000", "510000018febcfec00000000",
      "5040000100000feb00000001", "5040000100000fec00000002", "5100000380000feb80000fec",
      "000000000000000000000000",
    ];
    const execute = (selectionFlag: number) => {
      const vm = new HdmvVm([{ id: 0, instructions: [m3Fixtures.break] }]);
      vm.registers.write({ kind: "gpr", index: 0x0a28 }, selectionFlag);
      return vm.executeButtonProgram(commands, "ig_object");
    };
    const firstBranch = execute(0);
    const secondBranch = execute(1);
    expect(firstBranch.terminated).toBe(true); expect(firstBranch.fault).toBeNull();
    expect(secondBranch.terminated).toBe(true); expect(secondBranch.fault).toBeNull();
    expect(firstBranch.actions.filter((action) => action.type === "SET_STREAM").map((action) => action.payload.destinationRaw)).toEqual([0x8feb8fec]);
    expect(secondBranch.actions.filter((action) => action.type === "SET_STREAM").map((action) => action.payload.destinationRaw)).toEqual([0x8febcfec]);
    expect(firstBranch.actions.at(-1)?.type).toBe("SET_BUTTON_PAGE"); expect(secondBranch.actions.at(-1)?.type).toBe("SET_BUTTON_PAGE");
    expect(firstBranch.registers.psr[1]).toBe(1); expect(secondBranch.registers.psr[1]).toBe(1);
  });
  it("returns to idle at natural MovieObject end so later button programs can run", () => {
    const vm = new HdmvVm([{ id: 0, instructions: [m3Fixtures.move5] }]);
    expect(vm.runTurn().status).toBe("idle"); expect(vm.snapshot().diagnostic).toBeNull();
    const result = vm.executeButtonProgram([m3Fixtures.move5, m3Fixtures.break], "ig_object");
    expect(result.terminated).toBe(true); expect(result.fault).toBeNull();
    expect(result.registers.gpr[0]).toBe(5);
  });
  it("bounds button-program loops with the configured instruction budget", () => {
    const vm = new HdmvVm([{ id: 0, instructions: [m3Fixtures.break] }], { maxInstructionsPerTurn: 2 });
    const result = vm.executeButtonProgram([m3Fixtures.goto0]);
    expect(result.fault?.code).toBe("VM_EXECUTION_LIMIT"); expect(result.terminated).toBe(false);
    expect(result.instructionsThisTurn).toBe(2);
  });
  it("routes button-command actions through the existing action and continuation path", () => {
    const vm = new HdmvVm([{ id: 0, instructions: [m3Fixtures.break] }]);
    const source = { path: "BDMV/PLAYLIST/00001.mpls", origin: "primary" as const, offset: "0x2ac" };
    const state = vm.executeButtonCommand(m3Fixtures.playPlaylist42, source);
    expect(state.status).toBe("suspended"); expect(state.programId).toBe(0); expect(state.pc).toBe(0);
    expect(state.waiting?.type).toBe("PLAY_PLAYLIST"); expect(state.waiting?.source).toEqual(source);
    expect(vm.drainActions()[0]).toMatchObject({ type: "PLAY_PLAYLIST", payload: { playlist: 42 }, source, waitFor: "ended" });
    expect(vm.trace.at(-1)?.source).toEqual(source);
  });
  it("maps playlist commands to ended waits and ignores them in IG context", () => {
    const cases = [
      [m3Fixtures.playPlaylist42, "PLAY_PLAYLIST", { playlist: 42 }],
      [rawCommand(0x42c10000, 42, 3), "PLAY_PLAYLIST_ITEM", { playlist: 42, playItem: 3 }],
      [rawCommand(0x42c20000, 42, 4), "PLAY_PLAYLIST_MARK", { playlist: 42, playMark: 4 }],
    ] as const;
    for (const [command, actionType, payload] of cases) {
      const vm = new HdmvVm([{ id: 0, instructions: [command] }]);
      expect(vm.runTurn().status).toBe("suspended");
      expect(vm.actions[0]).toMatchObject({ type: actionType, payload, waitFor: "ended" });
      const igVm = new HdmvVm([{ id: 0, instructions: [m3Fixtures.break] }]);
      const result = igVm.executeButtonProgram([command], "ig_object");
      expect(result.fault).toBeNull();
      expect(igVm.actions).toHaveLength(0);
      expect(igVm.trace.find((entry) => entry.raw === (typeof command === "string" ? command : command.bytes))).toMatchObject({ diagnostic: { code: "HDMV_OPCODE_CONTEXT_SKIPPED", message: expect.stringContaining("ig_object") }, status: "running" });
    }
  });
  it("emits immediate IG page, button, popup, and still actions without invented waits", () => {
    const cases = [
      [m3Fixtures.popupOff, "POPUP_OFF"],
      [rawCommand(0x11000008), "STILL_ON"],
      [rawCommand(0x11000009), "STILL_OFF"],
      [rawCommand(0x31800004, 5), "ENABLE_BUTTON"],
      [rawCommand(0x31800005, 5), "DISABLE_BUTTON"],
    ] as const;
    for (const [command, actionType] of cases) {
      const vm = new HdmvVm([{ id: 0, instructions: [m3Fixtures.break] }]);
      const result = vm.executeButtonProgram([command], "ig_object");
      expect(result.fault).toBeNull(); expect(result.actions[0]?.type).toBe(actionType);
      expect(result.actions[0]).not.toHaveProperty("waitFor");
      const movieObject = new HdmvVm([{ id: 0, instructions: [command] }]);
      expect(movieObject.runTurn().status).toBe("idle");
      expect(movieObject.actions).toHaveLength(0);
    }
  });
  it("matches libbluray timer, output-mode, and 3D subtitle command behavior", () => {
    const timer = new HdmvVm([{ id: 0, instructions: [rawCommand(0x51c00002, 0, 5), m3Fixtures.break] }]);
    timer.registers.gpr[5] = 5;
    timer.runTurn();
    expect(timer.registers.read({ kind: "psr", index: 9 })).toBe(5);

    const output = new HdmvVm([{ id: 0, instructions: [rawCommand(0x3180000a, 1), m3Fixtures.break] }], { profile: { capabilityValues: { 31: 0x00130240 } } });
    output.registers.gpr[1] = 1;
    output.runTurn();
    expect(output.registers.read({ kind: "psr", index: 22 }) & 1).toBe(1);

    const twoD = new HdmvVm([{ id: 0, instructions: [rawCommand(0x51c0000b, 0, 0), m3Fixtures.break] }]);
    expect(twoD.runTurn().status).toBe("idle");
    expect(twoD.snapshot().diagnostic).toBeNull();

    const threeD = new HdmvVm([{ id: 0, instructions: [rawCommand(0x51c0000b, 0, 0)] }]);
    threeD.registers.systemWrite(22, 1);
    expect(threeD.runTurn().status).toBe("idle");
    expect(threeD.trace.find((entry) => entry.raw === rawCommand(0x51c0000b, 0, 0))).toMatchObject({ diagnostic: { code: "HDMV_3D_SUBTITLE_ALIGNMENT_UNIMPLEMENTED" }, status: "running" });
  });
  it("writes the pinned libbluray SETSYSTEM private PSR value", () => {
    const command = rawCommand(0x51000010, 0, 0);
    const vm = new HdmvVm([{ id: 0, instructions: [command] }]);
    vm.registers.gpr[0] = 77;
    expect(vm.runTurn().status).toBe("idle");
    expect(vm.registers.read({ kind: "psr", index: 103 })).toBe(77);
    expect(vm.trace.find((entry) => entry.raw === command)).toMatchObject({ status: "running", registerDelta: { psr: { 103: 77 } } });
  });
  it("applies immediate SET_BUTTON_PAGE operands in MovieObject context", () => {
    const words: [number, number, number] = [0x51c00003, 0x8000002a, 0x80000007];
    const bytes = words.map((word) => word.toString(16).padStart(8, "0")).join("");
    const vm = new HdmvVm([{ id: 0, instructions: [m3Fixtures.break] }]);
    const result = vm.executeButtonCommand(bytes);
    expect(result.registers.psr[10]).toBe(0x2a); expect(result.registers.psr[11]).toBe(7);
    expect(result.buttonCommandTerminated).toBe(false); expect(result.status).toBe("running");
    expect(vm.drainActions()).toHaveLength(0);
  });
  it("dereferences SET_BUTTON_PAGE GPR operands while preserving operand flags", () => {
    const words: [number, number, number] = [0x51000003, 0x80000000, 0x80000001];
    const bytes = words.map((word) => word.toString(16).padStart(8, "0")).join("");
    const vm = new HdmvVm([{ id: 0, instructions: [m3Fixtures.break] }]);
    vm.registers.write({ kind: "gpr", index: 0 }, 0x1234002a);
    vm.registers.write({ kind: "gpr", index: 1 }, 0x23450007);
    const result = vm.executeButtonCommand(bytes);
    expect(result.registers.psr[10]).toBe(0x2a); expect(result.registers.psr[11]).toBe(7);
  });
  it("emits packed SET_BUTTON_PAGE for IG-button context and reports sequence termination", () => {
    const words: [number, number, number] = [0x51c00003, 0x8000002a, 0xc0000003];
    const bytes = words.map((word) => word.toString(16).padStart(8, "0")).join("");
    const vm = new HdmvVm([{ id: 0, instructions: [m3Fixtures.break] }]);
    const result = vm.executeButtonCommand(bytes, undefined, "ig_object");
    expect(result.buttonCommandTerminated).toBe(true); expect(result.status).toBe("running");
    expect(result.registers.psr[10]).toBe(0xffff); expect(result.registers.psr[11]).toBe(0);
    const action = vm.drainActions()[0]!;
    expect(action.payload).toEqual({ packed: 0xe003002a }); expect(action).not.toHaveProperty("waitFor");
  });
  it("dereferences GPR operands and terminates an IG-button sequence", () => {
    const words: [number, number, number] = [0x51000003, 0x80000000, 0xc0000001];
    const bytes = words.map((word) => word.toString(16).padStart(8, "0")).join("");
    const vm = new HdmvVm([{ id: 0, instructions: [m3Fixtures.break] }]);
    vm.registers.write({ kind: "gpr", index: 0 }, 0x1234002a);
    vm.registers.write({ kind: "gpr", index: 1 }, 0x00000003);
    const result = vm.executeButtonCommand(bytes, undefined, "ig_object");
    expect(result.buttonCommandTerminated).toBe(true); expect(result.status).toBe("running");
    expect(vm.drainActions()[0]?.payload).toEqual({ packed: 0xe003002a });
  });
  it("applies compare semantics to the next command only", () => {
    const vm = new HdmvVm([{ id: 0, instructions: [m3Fixtures.move5, m3Fixtures.compareEq7, m3Fixtures.move5, m3Fixtures.break] }]);
    const state = vm.runTurn(); expect(state.registers.gpr[0]).toBe(5); expect(state.pc).toBe(4);
    const trueCompare = new HdmvVm([{ id: 0, instructions: [m3Fixtures.move5, { ...m3Fixtures.compareEq7, words: [m3Fixtures.compareEq7.words[0], 0, 5], bytes: [m3Fixtures.compareEq7.words[0], 0, 5].map((x) => x.toString(16).padStart(8, "0")).join("") }, m3Fixtures.add7, m3Fixtures.break] }]);
    expect(trueCompare.runTurn().registers.gpr[0]).toBe(12);
  });
  it("skips exactly the next command for true and false unsigned compare predicates", () => {
    const cases = [
      { op: 1, skip: [1, 0], proceed: [0, 0] }, // BC: (a & ~b) != 0
      { op: 2, skip: [7, 8], proceed: [7, 7] }, // EQ skips on inequality
      { op: 3, skip: [7, 7], proceed: [7, 8] }, // NE skips on equality
      { op: 4, skip: [6, 7], proceed: [8, 7] }, // GE skips when less
      { op: 5, skip: [7, 7], proceed: [8, 7] }, // GT skips when less/equal
      { op: 6, skip: [8, 7], proceed: [7, 8] }, // LE skips when greater
      { op: 7, skip: [8, 7], proceed: [7, 8] }, // LT skips when greater/equal
    ] as const;
    const compare = (option: number, a: number, b: number) => rawCommand(0x4cc00000 | (option << 8), a, b);
    const moveMarker = (value: number) => rawCommand(0x50400001, 0, value);
    for (const { op, skip, proceed } of cases) {
      for (const [pair, expected] of [[skip, 0], [proceed, 1]] as const) {
        const vm = new HdmvVm([{ id: 0, instructions: [compare(op, pair[0], pair[1]), moveMarker(1), m3Fixtures.break] }]);
        expect(vm.runTurn().registers.gpr[0], `compare opcode ${op} with ${pair}`).toBe(expected);
      }
    }
  });
  it("matches pinned uint32 arithmetic and bit-operation boundaries", () => {
    const run = (opcode: number, initial: number, operand: number) => {
      const vm = new HdmvVm([{ id: 0, instructions: [rawCommand(0x50400000 | opcode, 0, operand), m3Fixtures.break] }]);
      vm.registers.write({ kind: "gpr", index: 0 }, initial);
      const state = vm.runTurn();
      return { state, value: state.registers.gpr[0] };
    };
    expect(run(3, 0xfffffffe, 1).value).toBe(0xffffffff); // ADD saturation
    expect(run(4, 0, 1).value).toBe(0); // SUB underflow saturation
    expect(run(5, 0xffffffff, 2).value).toBe(0xffffffff); // MUL saturation
    expect(run(6, 123, 0).value).toBe(0xffffffff); // DIV by zero
    expect(run(7, 123, 0).value).toBe(0xffffffff); // MOD by zero
    expect(run(9, 0x80000001, 0xff).value).toBe(1); // AND
    expect(run(10, 0x80000000, 1).value).toBe(0x80000001); // OR
    expect(run(11, 0x80000001, 1).value).toBe(0x80000000); // XOR
    expect(run(12, 0, 31).value).toBe(0x80000000); // BITSET sign bit
    expect(run(13, 0xffffffff, 31).value).toBe(0x7fffffff); // BITCLR sign bit
    expect(run(14, 1, 31).value).toBe(0x80000000); // SHL boundary
    expect(run(15, 0x80000000, 31).value).toBe(1); // logical SHR boundary
    expect(run(14, 0xdeadbeef, 0).value).toBe(0xdeadbeef); // zero shift
    for (const opcode of [12, 13, 14, 15]) {
      const { state } = run(opcode, 1, 32);
      expect(state.status, `opcode ${opcode} with count 32`).toBe("faulted");
      expect(state.diagnostic?.code).toBe("HDMV_ILLEGAL_OPERAND");
    }
  });
  it("restores the saved object and PC for object call/resume", () => {
    const vm = new HdmvVm([
      { id: 0, instructions: [m3Fixtures.callObject1, m3Fixtures.move5, m3Fixtures.break] },
      { id: 1, instructions: [m3Fixtures.add7, m3Fixtures.resume] },
    ]);
    const state = vm.runTurn(); expect(state.registers.gpr[0]).toBe(5); expect(state.programId).toBe(0); expect(state.status).toBe("idle");
  });
  it("restores only the pinned PSR backup range on CALL/RESUME and keeps GPRs", () => {
    const addOne = rawCommand(0x50400003, 0, 1);
    const setButtonPage = rawCommand(0x51c00003, 0x8000002a, 0x80000007);
    const vm = new HdmvVm([
      { id: 0, instructions: [m3Fixtures.callObject1, addOne, m3Fixtures.break] },
      { id: 1, instructions: [m3Fixtures.playPlaylist42, setButtonPage, m3Fixtures.resume] },
    ]);
    expect(vm.runTurn().status).toBe("suspended");
    const action = vm.snapshot().waiting!;
    for (const [index, value] of [[4, 4], [5, 5], [6, 6], [7, 7], [8, 8], [9, 9], [10, 10], [11, 11], [12, 12]] as const) vm.registers.systemWrite(index, value);
    vm.registers.write({ kind: "gpr", index: 0 }, 99);
    expect(vm.handleEvent({ type: "MEDIA_STARTED", generation: action.generation, responseTo: action.id }).status).toBe("suspended");
    const returned = vm.handleEvent({ type: "MEDIA_ENDED", generation: action.generation, responseTo: action.id });
    expect(returned.status).toBe("idle"); expect(returned.programId).toBe(0);
    expect(returned.registers.gpr[0]).toBe(100); // GPRs are not part of bd_psr_save_state.
    expect(returned.registers.psr.slice(4, 9)).toEqual([0xffff, 0xffff, 0, 0, 0]);
    expect(returned.registers.psr.slice(10, 13)).toEqual([0xffff, 0, 0xff]);
    expect(returned.registers.psr[9]).toBe(9); // PSR9 is not in the saved range.
    expect(returned.registers.psr.slice(36, 41)).toEqual([0xffff, 0xffff, 0, 0, 0]);
    expect(returned.registers.psr.slice(42, 45)).toEqual([0xffff, 0, 0xff]);
  });
  it("replaces the single suspended call context and faults on invalid object targets", () => {
    const call2 = rawCommand(0x21820000, 2, 0);
    const vm = new HdmvVm([
      { id: 0, instructions: [m3Fixtures.callObject1, m3Fixtures.break] },
      { id: 1, instructions: [call2, m3Fixtures.resume] },
      { id: 2, instructions: [m3Fixtures.resume] },
    ]);
    expect(vm.runTurn().status).toBe("idle");
    expect(vm.snapshot().programId).toBe(1); // inner Resume returns to the latest caller
    expect(vm.snapshot().diagnostic).toBeNull();
    expect(vm.trace.find((entry) => entry.programId === 1 && entry.decoded === "RESUME")).toMatchObject({ diagnostic: { code: "HDMV_RESUME_WITHOUT_CALL" } }); // the earlier suspended caller was replaced

    const badJump = rawCommand(0x21800000, 99, 0);
    const invalid = new HdmvVm([{ id: 0, instructions: [badJump] }]);
    expect(invalid.runTurn()).toMatchObject({ status: "idle", programId: 0, callStack: [] });
    expect(invalid.snapshot().diagnostic).toBeNull();
    expect(invalid.trace.find((entry) => entry.decoded?.startsWith("JUMP_OBJECT"))).toMatchObject({ diagnostic: { code: "HDMV_INVALID_TARGET" } });
    const badCall = rawCommand(0x21820000, 99, 0);
    const invalidCall = new HdmvVm([{ id: 0, instructions: [badCall] }]);
    expect(invalidCall.runTurn()).toMatchObject({ status: "idle", programId: 0, callStack: [] });
    expect(invalidCall.snapshot().diagnostic).toBeNull();
    expect(invalidCall.trace.find((entry) => entry.decoded?.startsWith("CALL_OBJECT"))).toMatchObject({ diagnostic: { code: "HDMV_INVALID_TARGET" } });
  });
  it("validates title targets from M1 entries and emits JUMP_TITLE without a VM wait", () => {
    const jumpTitle = rawCommand(0x21810000, 1);
    const entries = [
      { id: "firstPlay:0", kind: "firstPlay" as const, target: { objectType: "HDMV" as const, playbackType: 0, target: 0, source: m3Fixtures.move5.source }, source: m3Fixtures.move5.source },
      { id: "topMenu:0", kind: "topMenu" as const, target: { objectType: "HDMV" as const, playbackType: 0, target: 0, source: m3Fixtures.move5.source }, source: m3Fixtures.move5.source },
      { id: "title:0", kind: "title" as const, target: { objectType: "HDMV" as const, playbackType: 0, target: 0, accessType: 0, source: m3Fixtures.move5.source }, source: m3Fixtures.move5.source },
    ];
    const vm = new HdmvVm([
      { id: 0, instructions: [m3Fixtures.callObject1, m3Fixtures.break] },
      { id: 1, instructions: [jumpTitle, m3Fixtures.break] },
    ], { entries });
    const result = vm.runTurn();
    const titleAction = vm.actions[0];
    expect(titleAction?.type).toBe("TITLE_SEARCH"); expect(titleAction?.payload).toEqual({ title: 1 });
    expect(titleAction).not.toHaveProperty("waitFor");
    expect(result.status).toBe("suspended"); expect(result.programId).toBe(1); expect(result.pc).toBe(1);
    expect(result.callStack).toEqual([]); expect(result.registers.psr.slice(36, 41)).toEqual([0xffff, 0xffff, 0, 0, 0]);

    const outOfRange = new HdmvVm([{ id: 0, instructions: [rawCommand(0x21810000, 2)] }], { entries });
    expect(outOfRange.runTurn()).toMatchObject({ status: "idle", pc: 1 });
    expect(outOfRange.snapshot().diagnostic).toBeNull();
    expect(outOfRange.trace.find((entry) => entry.decoded?.startsWith("JUMP_TITLE"))).toMatchObject({ diagnostic: { code: "HDMV_INVALID_TARGET" } });
    expect(outOfRange.actions).toHaveLength(0);

    for (const title of [0, 0xffff]) {
      const boundary = new HdmvVm([{ id: 0, instructions: [rawCommand(0x21810000, title), m3Fixtures.break] }], { entries });
      expect(boundary.runTurn().status).toBe("suspended");
      expect(boundary.actions[0]?.payload).toEqual({ title });
      expect(boundary.actions[0]).not.toHaveProperty("waitFor");
    }

    const missingTopMenu = entries.map((entry) => entry.kind === "topMenu" ? { ...entry, target: { ...entry.target, objectType: "unknown" as const, target: null } } : entry);
    const noMenu = new HdmvVm([{ id: 0, instructions: [rawCommand(0x21810000, 0)] }], { entries: missingTopMenu });
    const noMenuResult = noMenu.runTurn();
    expect(noMenuResult).toMatchObject({ status: "idle", pc: 1 });
    expect(noMenuResult.diagnostic).toBeNull();
    expect(noMenu.trace.find((entry) => entry.decoded?.startsWith("JUMP_TITLE"))).toMatchObject({ diagnostic: { code: "HDMV_INVALID_TARGET" } });
    const missingFirstPlay = entries.map((entry) => entry.kind === "firstPlay" ? { ...entry, target: { ...entry.target, objectType: "unknown" as const, target: null } } : entry);
    const noFirstPlay = new HdmvVm([{ id: 0, instructions: [rawCommand(0x21810000, 0xffff)] }], { entries: missingFirstPlay });
    const noFirstPlayResult = noFirstPlay.runTurn();
    expect(noFirstPlayResult).toMatchObject({ status: "idle", pc: 1 });
    expect(noFirstPlayResult.diagnostic).toBeNull();
    expect(noFirstPlay.trace.find((entry) => entry.decoded?.startsWith("JUMP_TITLE"))).toMatchObject({ diagnostic: { code: "HDMV_INVALID_TARGET" } });

    const noMetadata = new HdmvVm([{ id: 0, instructions: [rawCommand(0x21810000, 77), m3Fixtures.break] }]);
    expect(noMetadata.runTurn().status).toBe("suspended");
    expect(noMetadata.actions[0]?.payload).toEqual({ title: 77 });
    expect(noMetadata.actions[0]).not.toHaveProperty("waitFor");

    const callTitle = rawCommand(0x21830000, 1);
    const callEntries = entries.map((entry) => entry.kind === "title" ? { ...entry, target: { ...entry.target, target: 1 } } : entry);
    const called = new HdmvVm([
      { id: 0, instructions: [callTitle, m3Fixtures.move5, m3Fixtures.break] },
      { id: 1, instructions: [m3Fixtures.add7, m3Fixtures.resume] },
    ], { entries: callEntries });
    called.registers.systemWrite(4, 12);
    const titleCall = called.runTurn();
    expect(titleCall).toMatchObject({ status: "suspended", programId: 0, pc: 1, callStack: [{ programId: 0, pc: 1 }], registers: { psr: expect.arrayContaining([12]) } });
    expect(called.actions.at(-1)).toMatchObject({ type: "TITLE_SEARCH", payload: { title: 1 } });
    expect(called.actions.at(-1)).not.toHaveProperty("waitFor");
    expect(called.trace.find((entry) => entry.decoded?.startsWith("CALL_TITLE"))).toMatchObject({ status: "suspended", programId: 0, pc: 0, callDepth: 1 });
    expect(titleCall.registers.psr[4]).toBe(12); // PSR4 is set by title selection, not by CALL_TITLE.
    expect(called.selectTitle(2)).toMatchObject({ status: "suspended", programId: 0, pc: 1, callStack: [{ programId: 0, pc: 1 }] });
    expect(called.trace.at(-1)).toMatchObject({ decoded: "TITLE_SEARCH_RESPONSE_IGNORED", status: "suspended", callDepth: 1, diagnostic: { code: "HDMV_TITLE_RESPONSE_MISMATCH" } });
    const resumed = called.selectTitle(1);
    expect(resumed).toMatchObject({ status: "idle", programId: 0, registers: { gpr: expect.arrayContaining([5]), psr: expect.arrayContaining([12]) } });
    expect(resumed.registers.psr[4]).toBe(12);
    expect(called.trace.find((entry) => entry.decoded?.startsWith("CALL_TITLE"))?.registerDelta.psr[4]).toBeUndefined();
    expect(called.trace.find((entry) => entry.decoded === "TITLE_SELECTED title=1 object=1")?.registerDelta.psr[4]).toBe(1);
    expect(called.trace.some((entry) => entry.decoded?.startsWith("RESUME") && entry.programId === 1)).toBe(true);
    const badCallTitle = new HdmvVm([{ id: 0, instructions: [rawCommand(0x21830000, 2)] }], { entries });
    expect(badCallTitle.runTurn()).toMatchObject({ status: "idle", programId: 0, pc: 1, callStack: [] });
    expect(badCallTitle.snapshot().diagnostic).toBeNull();
    expect(badCallTitle.trace.find((entry) => entry.decoded?.startsWith("CALL_TITLE"))).toMatchObject({ status: "running", diagnostic: { code: "HDMV_INVALID_TARGET" } });
    const unresolvedCallEntries = callEntries.map((entry) => entry.kind === "title" ? { ...entry, target: { ...entry.target, objectType: "unknown" as const, target: null } } : entry);
    const unresolvedCall = new HdmvVm([{ id: 0, instructions: [callTitle] }], { entries: unresolvedCallEntries });
    expect(unresolvedCall.runTurn()).toMatchObject({ status: "idle", programId: 0, pc: 1, callStack: [] });
    expect(unresolvedCall.snapshot().diagnostic).toBeNull();
    expect(unresolvedCall.trace.find((entry) => entry.decoded?.startsWith("CALL_TITLE"))).toMatchObject({ diagnostic: { code: "HDMV_INVALID_TARGET" } });
    expect(unresolvedCall.actions).toHaveLength(0);
    const bdjCallEntries = callEntries.map((entry) => entry.kind === "title" ? { ...entry, target: { ...entry.target, objectType: "BDJ" as const, target: "00001" } } : entry);
    const bdjCall = new HdmvVm([{ id: 0, instructions: [callTitle] }], { entries: bdjCallEntries });
    expect(bdjCall.runTurn()).toMatchObject({ status: "idle", programId: 0, pc: 1, callStack: [], diagnostic: { code: "HDMV_UNVERIFIED_OPCODE", message: expect.stringContaining("unsupported BD-J") } });
    expect(bdjCall.actions).toHaveLength(0);
    const missingTable = new HdmvVm([{ id: 0, instructions: [callTitle] }]);
    expect(missingTable.runTurn().diagnostic?.code).toBe("HDMV_UNVERIFIED_OPCODE");
  });
  it("releases a title transition when the title table or player cannot start the title", () => {
    const jump = new HdmvVm([{ id: 0, instructions: [rawCommand(0x21810000, 1)] }]);
    expect(jump.runTurn()).toMatchObject({ status: "suspended" });
    expect(jump.snapshot().waiting).toBeNull();
    expect(jump.handleEvent({ type: "MEDIA_UNAVAILABLE" })).toMatchObject({ status: "idle", diagnostic: { code: "HDMV_MEDIA_UNAVAILABLE" } });

    const select = new HdmvVm([{ id: 0, instructions: [rawCommand(0x21810000, 1)] }]);
    select.runTurn();
    expect(select.selectTitle(1)).toMatchObject({ status: "idle", diagnostic: { code: "HDMV_UNVERIFIED_OPCODE" } });
  });
  it("restores an IG playlist continuation after CALL_TITLE selection and RESUME", () => {
    const source = m3Fixtures.move5.source;
    const entries = [
      { id: "firstPlay:0", kind: "firstPlay" as const, target: { objectType: "HDMV" as const, playbackType: 0, target: 0, source }, source },
      { id: "topMenu:0", kind: "topMenu" as const, target: { objectType: "HDMV" as const, playbackType: 0, target: 0, source }, source },
      { id: "title:0", kind: "title" as const, target: { objectType: "HDMV" as const, playbackType: 0, target: 2, accessType: 0, source }, source },
    ];
    const vm = new HdmvVm([
      { id: 0, instructions: [m3Fixtures.playPlaylist42, m3Fixtures.break] },
      { id: 1, instructions: [] },
      { id: 2, instructions: [m3Fixtures.resume] },
    ], { entries });
    expect(vm.runTurn()).toMatchObject({ status: "suspended", programId: 0, pc: 1 });
    const playlistAction = vm.snapshot().waiting!;
    expect(playlistAction.type).toBe("PLAY_PLAYLIST");
    vm.drainActions();

    const button = vm.executeButtonProgram([rawCommand(0x21830000, 1)], "ig_object");
    expect(button).toMatchObject({ status: "suspended", programId: 0, pc: 1, callStack: [{ programId: 0, pc: 1 }] });
    expect(button.actions.map((action) => action.type)).toEqual(["PLAY_STOP", "TITLE_SEARCH"]);
    expect(button.actions[1]).toMatchObject({ type: "TITLE_SEARCH", payload: { title: 1 } });
    expect(button.actions[1]).not.toHaveProperty("waitFor");

    const resumed = vm.selectTitle(1);
    const replayed = resumed.waiting!;
    expect(replayed).toMatchObject({ type: "PLAY_PLAYLIST", payload: { playlist: 42 }, waitFor: "ended" });
    expect(replayed.id).not.toBe(playlistAction.id);
    expect(resumed).toMatchObject({
      status: "suspended", programId: 0, pc: 1, callStack: [],
      playback: { status: "requested", playlist: 42, pendingActionId: replayed.id },
    });
    expect(vm.handleEvent({ type: "MEDIA_ENDED", generation: replayed.generation, responseTo: replayed.id })).toMatchObject({ status: "idle", programId: 0, pc: 2 });
    expect(vm.trace.some((entry) => entry.decoded?.startsWith("CALL_TITLE") && entry.status === "suspended" && entry.callDepth === 1)).toBe(true);
    expect(vm.trace.some((entry) => entry.decoded?.startsWith("RESUME") && entry.programId === 2 && entry.status === "suspended")).toBe(true);
  });
  it("uses the selected IG button PSR when a button computes a title target", () => {
    const source = m3Fixtures.move5.source;
    const jumpViaSelectedButton = [
      rawCommand(0x50000001, 12, 0x8000000a), // MOVE GPR12, PSR10
      rawCommand(0x50400003, 12, 2), // ADD GPR12, #2
      rawCommand(0x21010000, 12), // JUMP_TITLE GPR12
      m3Fixtures.break,
    ];
    const entries = [
      { id: "firstPlay:0", kind: "firstPlay" as const, target: { objectType: "HDMV" as const, playbackType: 0, target: 0, source }, source },
      { id: "topMenu:0", kind: "topMenu" as const, target: { objectType: "HDMV" as const, playbackType: 0, target: 0, source }, source },
      ...[1, 2].map((target, index) => ({ id: `title:${index}`, kind: "title" as const, target: { objectType: "HDMV" as const, playbackType: 0, target, accessType: 0, source }, source })),
    ];
    const uninitialized = new HdmvVm([{ id: 0, instructions: jumpViaSelectedButton }], { entries });
    expect(uninitialized.runTurn()).toMatchObject({ status: "idle", programId: 0, pc: 4 });
    expect(uninitialized.snapshot().diagnostic).toBeNull();
    expect(uninitialized.trace.find((entry) => entry.decoded?.startsWith("JUMP_TITLE"))).toMatchObject({ status: "running", diagnostic: { code: "HDMV_INVALID_TARGET" } });
    expect(uninitialized.actions).toHaveLength(0);

    const vm = new HdmvVm([{ id: 0, instructions: jumpViaSelectedButton }], { entries });
    vm.applyMenuContext(5, 0);
    expect(vm.snapshot().registers.psr[10]).toBe(0);
    expect(vm.snapshot().registers.psr[11]).toBe(5);
    expect(vm.runTurn().status).toBe("suspended");
    expect(vm.actions[0]).toMatchObject({ type: "TITLE_SEARCH", payload: { title: 2 } });
    expect(vm.trace.find((entry) => entry.decoded === "MENU_CONTEXT page=5 button=0")?.registerDelta.psr).toEqual({ 10: 0, 11: 5 });
  });
  it("passes the selected chapter button through GPR4095 to PLAY_PL_PM", () => {
    const source = m3Fixtures.move5.source;
    const entries = [
      { id: "firstPlay:0", kind: "firstPlay" as const, target: { objectType: "HDMV" as const, playbackType: 0, target: 0, source }, source },
      { id: "topMenu:0", kind: "topMenu" as const, target: { objectType: "HDMV" as const, playbackType: 0, target: 0, source }, source },
      { id: "title:0", kind: "title" as const, target: { objectType: "HDMV" as const, playbackType: 0, target: 2, accessType: 0, source }, source },
    ];
    for (const buttonId of [0, 3, 7]) {
      const vm = new HdmvVm([
        { id: 0, instructions: [] },
        { id: 1, instructions: [m3Fixtures.break] },
        { id: 2, instructions: [rawCommand(0x42820000, 0, 0x00000fff)] },
      ], { entries });
      vm.applyMenuContext(4, buttonId);
      const button = vm.executeButtonProgram([
        rawCommand(0x50000001, 12, 0x8000000a), // MOVE GPR12, PSR10
        rawCommand(0x50000001, 0x00000fff, 12), // MOVE GPR4095, GPR12
        rawCommand(0x21810000, 1), // JUMP_TITLE #1
      ], "ig_object");
      expect(button.actions[0]).toMatchObject({ type: "TITLE_SEARCH", payload: { title: 1 } });
      const selectedTitle = vm.selectTitle(1);
      expect(selectedTitle.status).toBe("suspended");
      expect(vm.actions.at(-1)).toMatchObject({ type: "PLAY_PLAYLIST_MARK", payload: { playlist: 0, playMark: buttonId } });
      expect(vm.snapshot().registers.gpr[4095]).toBe(buttonId);
    }

    const uninitialized = new HdmvVm([
      { id: 0, instructions: [] },
      { id: 1, instructions: [m3Fixtures.break] },
      { id: 2, instructions: [rawCommand(0x42820000, 0, 0x00000fff)] },
    ], { entries });
    uninitialized.executeButtonProgram([
      rawCommand(0x50000001, 12, 0x8000000a),
      rawCommand(0x50000001, 0x00000fff, 12),
      rawCommand(0x21810000, 1),
    ], "ig_object");
    uninitialized.selectTitle(1);
    expect(uninitialized.actions.at(-1)).toMatchObject({ type: "PLAY_PLAYLIST_MARK", payload: { playlist: 0, playMark: 0xffff } });
  });
  it("allows a jump to an existing empty object and ignores Link commands in MovieObjects", () => {
    const emptyTarget = new HdmvVm([{ id: 0, instructions: [m3Fixtures.jumpObject1] }, { id: 1, instructions: [] }]);
    expect(emptyTarget.runTurn()).toMatchObject({ programId: 1, pc: 0, status: "idle" });
    const pastEnd = new HdmvVm([{ id: 0, instructions: [rawCommand(0x20810000, 2)] }]);
    expect(pastEnd.runTurn()).toMatchObject({ status: "idle", pc: 2 });
    expect(pastEnd.snapshot().diagnostic).toBeNull();
    const movieLink = new HdmvVm([{ id: 0, instructions: [m3Fixtures.linkPlayItem3] }]);
    expect(movieLink.runTurn().status).toBe("idle"); expect(movieLink.actions).toHaveLength(0);
  });
  it("updates PSR5-8 from playlist and playback status events", () => {
    const vm = new HdmvVm([{ id: 0, instructions: [m3Fixtures.playPlaylist42, m3Fixtures.break] }]);
    const action = vm.runTurn().waiting!;
    expect(vm.registers.psr[5]).toBe(0xffff);
    expect(vm.registers.psr[6]).toBe(42);
    expect(vm.registers.psr[7]).toBe(0);
    expect(vm.registers.psr[8]).toBe(0);
    vm.handleEvent({ type: "PLAYITEM_CHANGED", generation: action.generation, responseTo: action.id, payload: { playItem: 2 } });
    expect(vm.registers.psr[7]).toBe(2);
    vm.handleEvent({ type: "TIME_UPDATED", generation: action.generation, responseTo: action.id, payload: { mediaTimeSeconds: 1.5 } });
    expect(vm.registers.psr[8]).toBe(67_500);
    vm.handleEvent({ type: "MEDIA_SEEKED", payload: { presentationTime: 90_000 } });
    expect(vm.registers.psr[8]).toBe(90_000);
    expect(vm.snapshot().waiting?.id).toBe(action.id);
  });
  it("allows TOP_MENU and POPUP_MENU while a playlist wait is pending", () => {
    const popupVm = new HdmvVm([{ id: 0, instructions: [m3Fixtures.playPlaylist42, m3Fixtures.break] }]);
    const popupAction = popupVm.runTurn().waiting!;
    const popup = popupVm.handleEvent({ type: "POPUP_MENU" });
    expect(popup.status).toBe("suspended");
    expect(popupVm.actions.at(-1)?.type).toBe("MENU_CALL");
    expect(popupVm.snapshot().waiting?.id).toBe(popupAction.id);

    const topVm = new HdmvVm([{ id: 0, instructions: [m3Fixtures.playPlaylist42, m3Fixtures.break] }], { entries: [] });
    topVm.runTurn();
    const top = topVm.handleEvent({ type: "TOP_MENU" });
    expect(top.status).toBe("suspended");
    expect(topVm.actions.at(-1)?.type).toBe("TITLE_SEARCH");
    expect(topVm.snapshot().waiting).toBeNull();
    // A title search that cannot resolve releases the transition.
    topVm.selectTitle(0);
    expect(topVm.snapshot().status).toBe("idle");
    expect(topVm.snapshot().waiting).toBeNull();
  });
  it("runs IG CALL_OBJECT while a playlist wait is pending and parks the playing position", () => {
    const vm = new HdmvVm([
      { id: 0, instructions: [m3Fixtures.playPlaylist42, m3Fixtures.break] },
      { id: 1, instructions: [m3Fixtures.move5, m3Fixtures.resume] },
    ]);
    const playlist = vm.runTurn().waiting!;
    const result = vm.executeButtonProgram([rawCommand(0x21820000, 1)], "ig_object");
    expect(result.status).toBe("suspended");
    expect(result.registers.gpr[0]).toBe(5);
    expect(result.actions.map((action) => action.type)).toEqual(expect.arrayContaining(["PLAY_STOP", "PLAY_PLAYLIST"]));
    const replayed = vm.snapshot().waiting!;
    expect(replayed.id).not.toBe(playlist.id);
    expect(vm.handleEvent({ type: "MEDIA_ENDED", generation: replayed.generation, responseTo: replayed.id }).status).toBe("idle");
  });
  it("suspends on playlist action until matching MEDIA_ENDED, not MEDIA_STARTED", () => {
    const vm = new HdmvVm([{ id: 0, instructions: [m3Fixtures.playPlaylist42, m3Fixtures.break] }]);
    expect(vm.runTurn().status).toBe("suspended");
    const action = vm.actions[0]!; expect(action.waitFor).toBe("ended");
    expect(vm.handleEvent({ type: "MEDIA_STARTED", generation: action.generation, responseTo: action.id }).status).toBe("suspended");
    expect(vm.snapshot().playback.status).toBe("playing");
    expect(vm.trace.at(-1)?.diagnostic).toBeUndefined();
    expect(vm.trace.find((x) => x.action?.id === action.id)?.action?.waitFor).toBe("ended");
    expect(vm.handleEvent({ type: "MEDIA_ENDED", generation: action.generation, responseTo: action.id }).status).toBe("idle");
    vm.handleEvent({ type: "MEDIA_ENDED", generation: action.generation, responseTo: action.id });
    expect(vm.trace.at(-1)?.diagnostic?.code).toBe("HDMV_DUPLICATE_EVENT");
  });
  it("faults unknown opcodes with raw/source evidence and bounds loops", () => {
    const unknownVm = new HdmvVm([{ id: 0, instructions: [m3Fixtures.unknown] }]);
    expect(unknownVm.runTurn().diagnostic?.code).toBe("HDMV_UNKNOWN_OPCODE");
    expect(unknownVm.trace.at(-1)?.raw).toBe(m3Fixtures.unknown.bytes);
    const loopVm = new HdmvVm([{ id: 0, instructions: [m3Fixtures.goto0] }], { maxInstructionsPerTurn: 4 });
    expect(loopVm.runTurn().diagnostic?.code).toBe("VM_EXECUTION_LIMIT");
  });
  it("reports nonzero reserved bits and ignores program PSR writes", () => {
    const reserved = Uint8Array.from(m3Fixtures.move5.bytes.match(/../g)!, (x) => Number.parseInt(x, 16)); reserved[2] = reserved[2]! | 0x10;
    expect(decodeInstruction(reserved, m3Fixtures.move5.source).issues).toContain("HDMV_RESERVED_BITS_NONZERO");
    const words: [number, number, number] = [m3Fixtures.move5.words[0], 0x80000004, 5]; const bytes = words.map((x) => x.toString(16).padStart(8, "0")).join("");
    const vm = new HdmvVm([{ id: 0, instructions: [{ words, bytes, source: m3Fixtures.move5.source }] }]);
    expect(vm.runTurn()).toMatchObject({ status: "idle" });
    expect(vm.snapshot().diagnostic).toBeNull();
    expect(vm.trace.find((entry) => entry.raw === bytes)?.diagnostic?.code).toBe("HDMV_ILLEGAL_OPERAND");
    const invalidReg = Uint8Array.from(m3Fixtures.move5.bytes.match(/../g)!, (x) => Number.parseInt(x, 16)); invalidReg.set([0, 0, 0x10, 0], 4);
    expect(decodeInstruction(invalidReg, m3Fixtures.move5.source).issues).toContain("HDMV_INVALID_REGISTER_ENCODING");
  });
  it("does not consume a continuation on a wrong event and stops on unavailable media", () => {
    const vm = new HdmvVm([{ id: 0, instructions: [m3Fixtures.playPlaylist42, m3Fixtures.break] }]); vm.runTurn();
    const action = vm.actions[0]!;
    vm.handleEvent({ type: "TIME_UPDATED", generation: action.generation, responseTo: action.id });
    expect(vm.snapshot().status).toBe("suspended");
    vm.handleEvent({ type: "MEDIA_UNAVAILABLE", generation: action.generation, responseTo: action.id });
    expect(vm.snapshot().status).toBe("stopped"); expect(vm.snapshot().diagnostic?.code).toBe("HDMV_MEDIA_UNAVAILABLE");
  });
  it("applies the normalized UO gate to keyboard and pointer input", () => {
    for (const channel of ["keyboard", "pointer"] as const) {
      const vm = new HdmvVm([{ id: 0, instructions: [m3Fixtures.break] }]);
      vm.handleEvent({ type: "MENU_INPUT", input: "activate", channel, payload: { objectId: 0, uoAllowed: false } });
      expect(vm.snapshot().programId).toBe(0); expect(vm.trace.at(-1)?.diagnostic?.code).toBe("HDMV_UO_BLOCKED");

      const allowedVm = new HdmvVm([
        { id: 0, instructions: [m3Fixtures.break] },
        { id: 1, instructions: [m3Fixtures.break] },
      ]);
      allowedVm.handleEvent({ type: "MENU_INPUT", input: "activate", channel, payload: { objectId: 1, uoAllowed: true } });
      expect(allowedVm.snapshot().programId).toBe(1); expect(allowedVm.trace.at(-1)?.event?.channel).toBe(channel);
    }
  });
  it("does not apply the user-operation gate to correlated media completion events", () => {
    const vm = new HdmvVm([{ id: 0, instructions: [m3Fixtures.playPlaylist42, m3Fixtures.break] }]);
    expect(vm.runTurn().status).toBe("suspended");
    const pending = vm.snapshot().waiting!;
    vm.handleEvent({ type: "MEDIA_STARTED", channel: "system", generation: pending.generation, responseTo: pending.id, payload: { uoAllowed: false } });
    expect(vm.snapshot().status).toBe("suspended");
    expect(vm.snapshot().playback.status).toBe("playing");
    expect(vm.trace.at(-1)?.diagnostic).toBeUndefined();

    vm.handleEvent({ type: "MEDIA_ENDED", channel: "system", generation: pending.generation, responseTo: pending.id, payload: { uoAllowed: false } });
    expect(vm.snapshot().status).toBe("idle");
    expect(vm.snapshot().waiting).toBeNull();
    expect(vm.trace.filter((entry) => entry.event?.type === "MEDIA_ENDED").at(-1)?.event?.channel).toBe("system");
  });
  it("runs a button program while a media continuation is suspended", () => {
    const vm = new HdmvVm([{ id: 0, instructions: [m3Fixtures.playPlaylist42, m3Fixtures.break] }]);
    vm.runTurn(); const action = vm.actions[0]!; const pending = vm.snapshot();
    const button = vm.executeButtonProgram([m3Fixtures.move5], "ig_object");
    expect(button.status).toBe("suspended");
    expect(button.registers.gpr[0]).toBe(5);
    expect(vm.snapshot().waiting?.id).toBe(action.id);
    expect(vm.snapshot().programId).toBe(pending.programId); expect(vm.snapshot().pc).toBe(pending.pc);
    vm.handleEvent({ type: "MEDIA_ENDED", generation: action.generation, responseTo: action.id });
    expect(vm.snapshot().programId).toBe(0); expect(vm.snapshot().registers.gpr[0]).toBe(5); expect(vm.snapshot().status).toBe("idle");
  });
  it("menu input during a playlist wait transfers the object and drops the playlist wait", () => {
    // libbluray _jump_object() clears playing_object during an interactive
    // composition transfer; _resume_from_play_pl() then finds no playing
    // object and a later playlist end leaves the VM untouched.
    const vm = new HdmvVm([
      { id: 0, instructions: [m3Fixtures.playPlaylist42, m3Fixtures.break] },
      { id: 1, instructions: [m3Fixtures.break] },
    ]);
    vm.runTurn(); const action = vm.actions[0]!;
    expect(vm.snapshot().status).toBe("suspended");
    vm.handleEvent({ type: "MENU_INPUT", payload: { objectId: 1 } });
    expect(vm.snapshot().programId).toBe(1);
    expect(vm.snapshot().waiting).toBeNull();
    expect(vm.snapshot().status).toBe("idle");
    expect(vm.trace.some((entry) => entry.action?.type === "PLAY_STOP")).toBe(true);
    vm.handleEvent({ type: "MEDIA_ENDED", generation: action.generation, responseTo: action.id });
    expect(vm.trace.at(-1)?.diagnostic?.code).toBe("HDMV_IGNORED_EVENT");
    expect(vm.snapshot().programId).toBe(1);
    expect(vm.snapshot().status).toBe("idle");
  });
  it("keeps the playlist continuation when a button command faults during a playlist wait", () => {
    // libbluray _vm_run() clears only the faulting object (p->object = NULL);
    // playing_object keeps waiting for playlist end and MEDIA_ENDED resumes it.
    const vm = new HdmvVm([{ id: 0, instructions: [m3Fixtures.playPlaylist42, m3Fixtures.break] }]);
    vm.runTurn(); const action = vm.actions[0]!;
    const faulted = vm.executeButtonProgram([{ words: [0x5040000c, 0, 32], bytes: "5040000c0000000000000020", source: m3Fixtures.move5.source }], "ig_object");
    expect(faulted.diagnostic?.code).toBe("HDMV_ILLEGAL_OPERAND");
    expect(faulted.status).toBe("suspended");
    expect(vm.snapshot().waiting?.id).toBe(action.id);
    expect(vm.snapshot().diagnostic?.code).toBe("HDMV_ILLEGAL_OPERAND");
    vm.handleEvent({ type: "MEDIA_ENDED", generation: action.generation, responseTo: action.id });
    expect(vm.snapshot().status).toBe("idle");
    expect(vm.snapshot().diagnostic?.code).toBe("HDMV_ILLEGAL_OPERAND");
  });
  it("keeps the playlist continuation suspended when a button command hits an unsupported operation", () => {
    // libbluray logs an unsupported operation and continues the current
    // object; the MovieObject waiting for playlist end keeps its wait.
    const vm = new HdmvVm([{ id: 0, instructions: [m3Fixtures.playPlaylist42, m3Fixtures.break] }]);
    vm.runTurn(); const action = vm.actions[0]!;
    const result = vm.executeButtonProgram([rawCommand(0x21830000, 1), m3Fixtures.move5], "ig_object");
    expect(result.diagnostic?.code).toBe("HDMV_UNVERIFIED_OPCODE");
    expect(result.status).toBe("suspended");
    expect(result.registers.gpr[0]).toBe(5);
    expect(vm.snapshot().waiting?.id).toBe(action.id);
    vm.handleEvent({ type: "MEDIA_ENDED", generation: action.generation, responseTo: action.id });
    expect(vm.snapshot().status).toBe("idle");
  });
  it("runs an IG JUMP_OBJECT while playlist playback is suspended and retires that wait", () => {
    const vm = new HdmvVm([
      { id: 0, instructions: [m3Fixtures.playPlaylist42, m3Fixtures.break] },
      { id: 1, instructions: [] },
    ]);
    vm.runTurn();
    const playlistAction = vm.snapshot().waiting!;

    const result = vm.executeButtonProgram([rawCommand(0x21800000, 1)], "ig_object");

    expect(result).toMatchObject({ status: "idle", programId: 1, waiting: null });
    expect(result.actions.map((action) => action.type)).toContain("PLAY_STOP");
    const afterLateMediaCompletion = vm.handleEvent({ type: "MEDIA_ENDED", generation: playlistAction.generation, responseTo: playlistAction.id });
    expect(afterLateMediaCompletion).toMatchObject({ status: "idle", programId: 1, waiting: null });
    expect(vm.trace.find((entry) => entry.decoded?.startsWith("JUMP_OBJECT"))).toMatchObject({ status: "running" });
  });
  it("keeps stopped and faulted VMs terminal when old events arrive", () => {
    const faulted = new HdmvVm([{ id: 0, instructions: [m3Fixtures.playPlaylist42, m3Fixtures.break] }], { maxQueueDepth: 1 });
    faulted.runTurn(); const oldAction = faulted.actions[0]!;
    faulted.enqueueEvent({ type: "TIME_UPDATED" }); faulted.enqueueEvent({ type: "TIME_UPDATED" });
    expect(faulted.snapshot().status).toBe("faulted"); expect(faulted.snapshot().waiting).toBeNull();
    const faultedBefore = faulted.snapshot();
    faulted.handleEvent({ type: "MEDIA_STARTED", generation: oldAction.generation, responseTo: oldAction.id });
    expect(faulted.snapshot().status).toBe("faulted"); expect(faulted.snapshot().pc).toBe(faultedBefore.pc);
    expect(faulted.snapshot().registers).toEqual(faultedBefore.registers); expect(faulted.trace.at(-1)?.diagnostic?.code).toBe("HDMV_EVENT_AFTER_TERMINAL");

    const stopped = new HdmvVm([{ id: 0, instructions: [m3Fixtures.playPlaylist42, m3Fixtures.break] }, { id: 1, instructions: [m3Fixtures.break] }]);
    stopped.runTurn(); const waiting = stopped.snapshot().waiting!;
    stopped.handleEvent({ type: "MEDIA_UNAVAILABLE", generation: waiting.generation, responseTo: waiting.id });
    expect(stopped.snapshot().status).toBe("stopped");
    stopped.handleEvent({ type: "MENU_INPUT", payload: { objectId: 1 } });
    expect(stopped.snapshot().status).toBe("stopped"); expect(stopped.snapshot().programId).toBe(0);
  });
  it("turns invalid user targets and action queue overflow into VM diagnostics", () => {
    const badTarget = new HdmvVm([{ id: 0, instructions: [m3Fixtures.break] }]);
    expect(() => badTarget.handleEvent({ type: "MENU_INPUT", payload: { objectId: 77 } })).not.toThrow();
    expect(badTarget.snapshot().status).toBe("idle");
    expect(badTarget.snapshot().diagnostic).toBeNull();
    expect(badTarget.trace.find((entry) => entry.event?.type === "MENU_INPUT")).toMatchObject({ diagnostic: { code: "HDMV_INVALID_TARGET" } });
    expect(badTarget.trace.at(-1)?.event?.type).toBe("MENU_INPUT");

    const fullQueue = new HdmvVm([{ id: 0, instructions: [m3Fixtures.break] }], { maxQueueDepth: 0 });
    expect(() => fullQueue.handleEvent({ type: "TOP_MENU" })).not.toThrow();
    expect(fullQueue.snapshot().status).toBe("faulted"); expect(fullQueue.snapshot().diagnostic?.code).toBe("VM_QUEUE_LIMIT");
    expect(fullQueue.trace.at(-1)?.event?.type).toBe("TOP_MENU");
  });
  it("routes top menu to title selection with input blocked until the search resolves, and emits popup requests without a VM wait", () => {
    const top = new HdmvVm([{ id: 0, instructions: [m3Fixtures.break] }]);
    expect(top.handleEvent({ type: "TOP_MENU" }).status).toBe("suspended");
    expect(top.snapshot().waiting).toBeNull();
    expect(top.actions.at(-1)).toMatchObject({ type: "TITLE_SEARCH", payload: { title: 0 } });
    expect(top.actions.at(-1)).not.toHaveProperty("waitFor");
    top.selectTitle(0);
    expect(top.snapshot().status).toBe("idle");
    // libbluray serializes bd_menu_call() with the title start under one lock,
    // so a second menu call cannot interleave while the first search is
    // unresolved. Input is blocked until selectTitle() consumes the search.
    const entries = [{ id: "topMenu:0", kind: "topMenu" as const, target: { objectType: "HDMV" as const, playbackType: 0, target: 0, source: m3Fixtures.move5.source }, source: m3Fixtures.move5.source }];
    const menu = new HdmvVm([{ id: 0, instructions: [m3Fixtures.break] }], { entries });
    menu.handleEvent({ type: "TOP_MENU" });
    expect(menu.actions.filter((action) => action.type === "TITLE_SEARCH")).toHaveLength(1);
    menu.handleEvent({ type: "TOP_MENU" });
    expect(menu.trace.at(-1)?.diagnostic?.code).toBe("HDMV_INPUT_WHILE_SUSPENDED");
    expect(menu.actions.filter((action) => action.type === "TITLE_SEARCH")).toHaveLength(1);
    menu.selectTitle(0);
    expect(menu.snapshot().status).toBe("idle");
    menu.handleEvent({ type: "TOP_MENU" });
    expect(menu.actions.filter((action) => action.type === "TITLE_SEARCH")).toHaveLength(2);

    const popup = new HdmvVm([{ id: 0, instructions: [m3Fixtures.break] }]);
    expect(popup.handleEvent({ type: "POPUP_MENU" }).status).toBe("idle");
    expect(popup.snapshot().waiting).toBeNull();
    expect(popup.actions.at(-1)).toMatchObject({ type: "MENU_CALL" });
    expect(popup.actions.at(-1)).not.toHaveProperty("waitFor");
  });
  it("emits IG LINK actions without suspending the VM", () => {
    const linkMark = rawCommand(0x22850000, 7);
    const vm = new HdmvVm([{ id: 0, instructions: [m3Fixtures.break] }]);
    const result = vm.executeButtonProgram([m3Fixtures.linkPlayItem3, linkMark], "ig_object"); const [item, mark] = vm.actions;
    expect(result.status).toBe("running"); expect(result.waiting).toBeNull(); expect(item?.type).toBe("LINK_PLAY_ITEM"); expect(item).not.toHaveProperty("waitFor");
    expect(mark?.type).toBe("LINK_PLAY_MARK"); expect(mark).not.toHaveProperty("waitFor");
    expect(result.terminated).toBe(true);
  });
  it("emits PLAY_STOP and terminates an IG-button sequence without waiting for MEDIA_ENDED", () => {
    const vm = new HdmvVm([{ id: 0, instructions: [m3Fixtures.break] }]);
    const result = vm.executeButtonProgram([m3Fixtures.terminatePlaylist], "ig_object");
    expect(result.buttonCommandTerminated).toBe(true); expect(result.terminated).toBe(true);
    expect(result.status).toBe("running"); expect(result.waiting).toBeNull();
    expect(result.actions[0]?.type).toBe("PLAY_STOP"); expect(result.actions[0]).not.toHaveProperty("waitFor");
    const movieObject = new HdmvVm([{ id: 0, instructions: [m3Fixtures.terminatePlaylist] }]);
    expect(movieObject.runTurn().status).toBe("idle"); expect(movieObject.actions).toHaveLength(0);
  });
  it("resumes the suspended MovieObject continuation after IG TERMINATE_PL emits PLAY_STOP", () => {
    const addOne = rawCommand(0x50400003, 0, 1);
    const vm = new HdmvVm([{ id: 0, instructions: [m3Fixtures.playPlaylist42, addOne, m3Fixtures.break] }]);
    vm.registers.write({ kind: "gpr", index: 0 }, 8);
    expect(vm.runTurn().status).toBe("suspended");
    const playlistAction = vm.snapshot().waiting!;
    expect(playlistAction.type).toBe("PLAY_PLAYLIST"); expect(playlistAction.waitFor).toBe("ended");

    const button = vm.executeButtonProgram([m3Fixtures.move5, m3Fixtures.terminatePlaylist], "ig_object");
    expect(button.buttonCommandTerminated).toBe(true); expect(button.actions.map((action) => action.type)).toEqual(["PLAY_STOP"]);
    expect(button.status).toBe("idle"); expect(button.waiting).toBeNull(); expect(button.programId).toBe(0);
    expect(button.registers.gpr[0]).toBe(6); // button command sets 5; resumed MovieObject ADD executes next
    expect(vm.trace.findIndex((entry) => entry.action?.type === "PLAY_STOP")).toBeLessThan(vm.trace.findIndex((entry) => entry.decoded === "ADD gpr[0],#1"));

    const afterStop = vm.snapshot();
    vm.handleEvent({ type: "MEDIA_ENDED", generation: playlistAction.generation, responseTo: playlistAction.id });
    expect(vm.snapshot().pc).toBe(afterStop.pc); expect(vm.snapshot().registers).toEqual(afterStop.registers);
  });
  it("enforces register bounds and resets the player profile deterministically", () => {
    const regs = new RegisterFile({ audioLanguage: 0x656e67, region: 4, capabilityValues: { 15: 0x1234 } });
    expect(regs.read({ kind: "psr", index: 0 })).toBe(1); expect(regs.read({ kind: "psr", index: 16 })).toBe(0x656e67);
    expect(regs.read({ kind: "psr", index: 15 })).toBe(0x1234); expect(regs.read({ kind: "psr", index: 20 })).toBe(4);
    expect(() => regs.read({ kind: "gpr", index: 4096 })).toThrow(/out of range/);
    expect(() => regs.write({ kind: "gpr", index: 0 }, -1)).toThrow(/uint32/);
  });
  it("matches pinned register bounds, uint32 words, and PSR write permissions", () => {
    const regs = new RegisterFile();
    expect(regs.gpr).toHaveLength(4096);
    expect(regs.psr).toHaveLength(128);
    regs.write({ kind: "gpr", index: 4095 }, 0xffffffff);
    expect(regs.read({ kind: "gpr", index: 4095 })).toBe(0xffffffff);
    regs.systemWrite(1, 0x80000000);
    expect(regs.read({ kind: "psr", index: 1 })).toBe(0x80000000);
    expect(() => regs.read({ kind: "gpr", index: 4096 })).toThrow(/out of range/);
    expect(() => regs.write({ kind: "gpr", index: 4096 }, 0)).toThrow(/out of range/);
    expect(() => regs.read({ kind: "psr", index: 128 })).toThrow(/out of range/);
    expect(() => regs.systemWrite(128, 0)).toThrow(/out of range/);
    expect(() => regs.write({ kind: "psr", index: 1 }, 2)).toThrow(/Program write to PSR/);
    expect(() => regs.systemWrite(21, 2)).toThrow(/read-only PSR 21/);
    expect(() => regs.systemWrite(13, 2)).toThrow(/read-only PSR 13/);
    expect(() => regs.systemWrite(1, -1)).toThrow(/uint32/);
    expect(() => regs.systemWrite(1, 0x1_0000_0000)).toThrow(/uint32/);
  });
  it("matches the complete pinned libbluray PSR initialization when no profile overrides are supplied", () => {
    const regs = new RegisterFile();
    const expected = [
      1, 0xff, 0x0fff0fff, 1, 0xffff, 0xffff, 0, 0, 0, 0, 0xffff, 0, 0xff, 0xff, 0xffff,
      0xaaaa, 0xffffff, 0xffffff, 0xffffff, 0xffff, 2, 0, 0, 0, 0, 0, 0, 0, 0, 0x03, 0x1ffff, 0x00030200,
      0, 0, 0, 0, 0xffff, 0xffff, 0, 0, 0, 0, 0xffff, 0, 0xff, 0, 0, 0,
      ...Array.from({ length: 14 }, () => 0xffffffff),
    ];
    expect([...regs.psr.slice(0, 62)]).toEqual(expected);
    expect([...regs.psr.slice(62)]).toEqual(Array.from({ length: 66 }, () => 0));

    const first = regs.snapshot();
    regs.write({ kind: "gpr", index: 4 }, 77);
    regs.reset();
    expect(regs.snapshot()).toEqual(first);
  });
  it("maps an explicit PlayerProfile onto its PSR fields without changing unrelated libbluray defaults", () => {
    const regs = new RegisterFile({
      audioLanguage: "eng", subtitleLanguage: "fra", menuLanguage: "jpn", country: "US", region: "A",
      outputPreference: 1,
    });
    expect([...regs.psr.slice(16, 22)]).toEqual([0x656e67, 0x667261, 0x6a706e, 0x5553, 1, 1]);
    expect(regs.psr[15]).toBe(0xaaaa);
    expect(regs.psr[23]).toBe(0); expect(regs.psr[29]).toBe(0x03); expect(regs.psr[31]).toBe(0x00030200);

    regs.reset({ audioLanguage: "jpn", region: "C" });
    expect([...regs.psr.slice(16, 22)]).toEqual([0x6a706e, 0xffffff, 0xffffff, 0xffff, 4, 0]);
  });
  it("accepts raw caller capability and output preference words without deriving mappings", () => {
    const regs = new RegisterFile({
      audioLanguage: "jpn", subtitleLanguage: "fra", menuLanguage: "deu", country: "JP", region: "C",
      outputProfile: "portable", outputPreference: 0x1234,
      capabilityValues: { 15: 0x1234, 29: 0x87654321, 31: 0x2222, 48: 0x89abcdef },
    });
    expect(regs.psr[16]).toBe(0x6a706e); expect(regs.psr[17]).toBe(0x667261); expect(regs.psr[18]).toBe(0x646575);
    expect(regs.psr[19]).toBe(0x4a50); expect(regs.psr[20]).toBe(4); expect(regs.psr[21]).toBe(0x1234);
    expect(regs.psr[15]).toBe(0x1234); expect(regs.psr[29]).toBe(0x87654321); expect(regs.psr[31]).toBe(0x2222);
    expect(regs.psr[48]).toBe(0x89abcdef);
  });
  it("rejects malformed language/country strings, invalid regions, and out-of-range raw words", () => {
    expect(() => new RegisterFile({ audioLanguage: "en" })).toThrow(/3 ASCII letters/);
    expect(() => new RegisterFile({ country: "USA" })).toThrow(/2 ASCII letters/);
    expect(() => new RegisterFile({ region: "D" as "A" })).toThrow();
    expect(() => new RegisterFile({ outputPreference: -1 })).toThrow(/unsigned 32-bit/);
    expect(() => new RegisterFile({ capabilityValues: { 15: 0x1_0000_0000 } })).toThrow(/unsigned 32-bit/);
  });
  it("applies the observed saturation and divide-by-zero results", () => {
    const alter = (base: typeof m3Fixtures.move5, w1: number, w2: number) => {
      const words: [number, number, number] = [base.words[0], w1 >>> 0, w2 >>> 0];
      return { ...base, words, bytes: words.map((x) => x.toString(16).padStart(8, "0")).join("") };
    };
    const moveMax = alter(m3Fixtures.move5, 0, 0xffffffff); const addOne = alter(m3Fixtures.add7, 0, 1); const divZero = alter({ ...m3Fixtures.add7, words: [(m3Fixtures.add7.words[0] & 0xffffffe0) | 6, 0, 0], bytes: "" }, 0, 0);
    const vm = new HdmvVm([{ id: 0, instructions: [moveMax, addOne, divZero, m3Fixtures.break] }]);
    const state = vm.runTurn(); expect(state.registers.gpr[0]).toBe(0xffffffff);
  });
  it("enforces configured call and action queue limits independently", () => {
    const callVm = new HdmvVm([{ id: 0, instructions: [m3Fixtures.callObject1] }, { id: 1, instructions: [m3Fixtures.break] }], { maxCallDepth: 0 });
    expect(callVm.runTurn().diagnostic?.code).toBe("VM_CALL_DEPTH_LIMIT");
    const queueVm = new HdmvVm([{ id: 0, instructions: [m3Fixtures.break] }], { maxQueueDepth: 2 });
    expect(queueVm.executeButtonProgram([m3Fixtures.popupOff, m3Fixtures.popupOff, m3Fixtures.popupOff], "ig_object").diagnostic?.code).toBe("VM_QUEUE_LIMIT");
  });
  it("releases action queue budget when completed or drained actions leave the queue", () => {
    const stream = rawCommand(0x51c00001, 0x80010000, 0);
    const drained = new HdmvVm([{ id: 0, instructions: [m3Fixtures.playPlaylist42, stream, m3Fixtures.break] }], { maxQueueDepth: 1 });
    drained.runTurn(); const first = drained.drainActions()[0]!;
    expect(drained.handleEvent({ type: "MEDIA_ENDED", generation: first.generation, responseTo: first.id }).status).toBe("idle");
    expect(drained.snapshot().diagnostic).toBeNull(); expect(drained.drainActions()).toHaveLength(1);
    const completed = new HdmvVm([{ id: 0, instructions: [m3Fixtures.playPlaylist42, stream, m3Fixtures.break] }], { maxQueueDepth: 1 });
    completed.runTurn(); const action = completed.actions[0]!;
    expect(completed.handleEvent({ type: "MEDIA_ENDED", generation: action.generation, responseTo: action.id }).status).toBe("idle");
    expect(completed.snapshot().diagnostic).toBeNull();
  });
  it("produces stable trace for the same profile and command input", () => {
    const create = () => new HdmvVm([{ id: 0, instructions: [m3Fixtures.move5, m3Fixtures.break] }], { profile: { audioLanguage: 0x656e67 } });
    const a = create(); const b = create(); a.runTurn(); b.runTurn(); expect(a.trace).toEqual(b.trace);
  });
  it("normalizes shared defaults and preserves raw profile words in reset traces", () => {
    const vm = new HdmvVm([]);
    const resetProfile = (entry: typeof vm.trace[number]) => JSON.parse(entry.decoded!.slice("RESET profile=".length, entry.decoded!.lastIndexOf("}" ) + 1));
    expect(resetProfile(vm.trace[0]!)).toEqual({
      audioLanguage: "eng", audioProfiles: [], country: "US", menuLanguage: "eng",
      outputProfile: "portable", region: "A", subtitleLanguage: "eng", videoProfiles: [],
    });
    expect([...vm.registers.psr.slice(16, 22)]).toEqual([0x656e67, 0x656e67, 0x656e67, 0x5553, 1, 0]);

    vm.reset(0, { audioLanguage: 0x6a706e, region: "C", capabilityValues: { 15: 0x1234 } });
    expect(resetProfile(vm.trace.at(-1)!)).toEqual({
      audioLanguage: 0x6a706e, audioProfiles: [], capabilityValues: { 15: 0x1234 }, country: "US",
      menuLanguage: "eng", outputProfile: "portable", region: "C", subtitleLanguage: "eng", videoProfiles: [],
    });
    expect(vm.registers.psr[16]).toBe(0x6a706e); expect(vm.registers.psr[15]).toBe(0x1234);
    expect([...vm.registers.psr.slice(17, 22)]).toEqual([0x656e67, 0x656e67, 0x5553, 4, 0]);

    vm.reset();
    expect(resetProfile(vm.trace.at(-1)!)).toEqual(resetProfile(vm.trace.at(-2)!));
  });
  it("maps each explicit HdmvVm player setting to its reference PSR and reset trace", () => {
    const vm = new HdmvVm([], { profile: {
      menuLanguage: "jpn", audioLanguage: "fra", subtitleLanguage: "deu", country: "JP", region: "B",
      outputProfile: "portable",
    } });
    expect([...vm.registers.psr.slice(16, 22)]).toEqual([0x667261, 0x646575, 0x6a706e, 0x4a50, 2, 0]);
    const profile = JSON.parse(vm.trace[0]!.decoded!.slice("RESET profile=".length, vm.trace[0]!.decoded!.lastIndexOf("}") + 1));
    expect(profile).toMatchObject({ audioLanguage: "fra", subtitleLanguage: "deu", menuLanguage: "jpn", country: "JP", region: "B" });

    vm.reset(0, { menuLanguage: 0x656e67, audioLanguage: "jpn", subtitleLanguage: "fra", country: 0x5553, region: "C", outputPreference: 1 });
    expect([...vm.registers.psr.slice(16, 22)]).toEqual([0x6a706e, 0x667261, 0x656e67, 0x5553, 4, 1]);
    const resetProfile = JSON.parse(vm.trace.at(-1)!.decoded!.slice("RESET profile=".length, vm.trace.at(-1)!.decoded!.lastIndexOf("}") + 1));
    expect(resetProfile).toMatchObject({ audioLanguage: "jpn", subtitleLanguage: "fra", menuLanguage: 0x656e67, country: 0x5553, region: "C", outputPreference: 1 });
  });
  it("keeps dynamic graph edges unresolved and unknown commands visible", () => {
    const graph = buildNavigationGraph([{ id: 0, instructions: [m3Fixtures.unknown] }]);
    expect(graph.nodes.some((x) => x.status === "unknown")).toBe(true);
    expect(graph.edges.some((x) => x.kind === "unknown" && x.resolution === "unresolved")).toBe(true);
    const raw = m3Fixtures.jumpObject1; const words: [number, number, number] = [raw.words[0] & ~0x00800000, 0, 0];
    const dynamicJump = { ...raw, words, bytes: words.map((x) => x.toString(16).padStart(8, "0")).join("") };
    const dynamic = buildNavigationGraph([{ id: 0, instructions: [dynamicJump] }]);
    expect(dynamic.edges.some((x) => x.kind === "jump" && x.resolution === "unresolved")).toBe(true);
  });
  it("resolves immediate playlist targets and retains the continuation after playback", () => {
    const graph = buildNavigationGraph([{ id: 0, instructions: [rawCommand(0x22800000, 1), rawCommand(0x42c10000, 2, 1), m3Fixtures.break] }]);
    expect(graph.edges).toEqual(expect.arrayContaining([
      expect.objectContaining({ from: "command:0:0", kind: "play", to: "playlist:00001", resolution: "resolved" }),
      expect.objectContaining({ from: "command:0:0", kind: "sequence", to: "command:0:1", resolution: "resolved" }),
      expect.objectContaining({ from: "command:0:1", kind: "play", to: "playlist:00002", resolution: "resolved" }),
    ]));
    const dynamic = buildNavigationGraph([{ id: 0, instructions: [rawCommand(0x22000000, 0)] }]);
    expect(dynamic.edges).toContainEqual(expect.objectContaining({ kind: "play", to: null, resolution: "unresolved" }));
  });
  it("connects static HDMV title entries while retaining unresolved dynamic or BD-J targets", () => {
    const source = m3Fixtures.move5.source;
    const entries = [{ id: "title:0", kind: "title" as const, source, target: { objectType: "HDMV" as const, playbackType: 0, target: 1, source } }];
    const graph = buildNavigationGraph([{ id: 0, instructions: [rawCommand(0x21830000, 1), m3Fixtures.break] }, { id: 1, instructions: [m3Fixtures.resume] }], [], { entries });
    expect(graph.edges).toEqual(expect.arrayContaining([
      expect.objectContaining({ from: "command:0:0", kind: "call", to: "object:1", resolution: "resolved" }),
      expect.objectContaining({ from: "command:0:0", kind: "sequence", to: "command:0:1", resolution: "resolved" }),
      expect.objectContaining({ from: "command:1:0", kind: "resume", to: null, resolution: "unresolved" }),
    ]));
    const bdj = entries.map((entry) => ({ ...entry, target: { ...entry.target, objectType: "BDJ" as const, target: "00001" } }));
    const unresolved = buildNavigationGraph([{ id: 0, instructions: [rawCommand(0x21830000, 1)] }], [], { entries: bdj });
    expect(unresolved.edges).toContainEqual(expect.objectContaining({ kind: "call", to: null, resolution: "unresolved" }));
  });
  it("adds button-like programs to the same graph analyzer and marks budget exhaustion unknown", () => {
    const object = { id: 0, instructions: [m3Fixtures.jumpObject1], resumeIntention: false, menuCallMask: false, titleSearchMask: false, source: m3Fixtures.move5.source };
    const appended = { id: 1, instructions: [m3Fixtures.break] };
    const graph = buildNavigationGraph([object], [appended], { maxStates: 1 });
    expect(graph.nodes.some((x) => x.id === "object:1")).toBe(true); expect(graph.complete).toBe(false);
    expect(graph.edges.some((x) => x.kind === "unknown" && x.resolution === "unresolved")).toBe(true);
  });
  it("publishes stable fixture identifiers for parent integration", () => { expect(M3_FIXTURE_IDS).toHaveLength(7); });
});

import { describe, expect, it } from "vitest";
import { IG_PID, syntheticMenuSegments } from "../../tests/helpers/fixtures.js";
import { consumeSegment, createIgsState, parseSegments } from "./igs.js";

describe("IGS object decoding", () => {
  it("keeps repeated ODS pixels independent and preserves offsets across time domains", () => {
    const state = createIgsState();
    const ods = parseSegments(syntheticMenuSegments()).segments.find((segment) => segment.type === 0x15)!;
    const sourcePts = { raw: 100n, epoch: 0n, normalized: 100n, timeDomain: 0 };
    consumeSegment(state, ods, "00001", IG_PID, sourcePts, 0n, 0n, 0n);
    const first = [...state.objects.values()][0]!;
    first.indices[0] = 99;
    consumeSegment(state, ods, "00001", IG_PID, { ...sourcePts, timeDomain: 1 }, 192n, 192n, 192n);
    const second = [...state.objects.values()][1]!;
    expect(second.indices).toEqual(Uint8Array.of(1));
    expect(second.source).toMatchObject({ timeDomain: 1, segmentFileOffset: "192" });
    second.indices[0] = 88;
    consumeSegment(state, ods, "00001", IG_PID, { ...sourcePts, timeDomain: 2 }, 384n, 384n, 384n);
    const third = [...state.objects.values()][2]!;
    expect(third.indices).toEqual(Uint8Array.of(1));
    expect(third.source).toMatchObject({ timeDomain: 2, segmentFileOffset: "384" });
    const changed = ods.data.slice();
    changed[11] = 2;
    consumeSegment(state, { ...ods, data: changed }, "00001", IG_PID, { ...sourcePts, timeDomain: 2 }, 576n, 576n, 576n);
    expect([...state.objects.values()][2]?.indices).toEqual(Uint8Array.of(2));
    expect(third.indices).toEqual(Uint8Array.of(1));
  });
});

#!/usr/bin/env python3
"""Generate the pinned libbluray 1.5.0 evidence baselines.

This is a local evidence-generation tool, not part of the test suite or CI.
It requires:

  * a local libbluray 1.5.0 installation (dylib + static archive + bd_info +
    bd_list_titles),
  * the pinned libbluray source under .reference-cache/repositories/,
  * the pinned bdmvkit ctypes harness under .reference-cache/repositories/,
  * clang, and the link dependencies of the static archive.

It writes two JSON files under docs/evidence/. Both contain case/clip ids,
numeric fields and libbluray's own output. The committed tests read only those
JSON files and the checked-in fixtures; CI runs neither this script nor libbluray.

Usage:  python3 scripts/generate-libbluray-baselines.py
"""

from __future__ import annotations

import json
import os
import re
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CACHE = ROOT / ".reference-cache" / "repositories"
LIBBLURAY_SRC = CACHE / "libbluray-1.5.0" / "src"
IGS_DUMP_SRC = ROOT / "scripts" / "libbluray-igs-dump.c"
CORPUS_ROOT = ROOT / "test-data" / "fixtures" / "hdmv-navigation" / "disc-data"
EVIDENCE = ROOT / "docs" / "evidence"

NAVIGATION_CASES = ["tamako", "baja", "kyoani-ova", "bang-dream-mygo-vol1", "battle-royale-uhd"]
IG_CASES = [
    ("baja", "00005", 0x1400),
    ("bang-dream-mygo-vol1", "00010", 0x1400),
    ("bang-dream-mygo-vol1", "00011", 0x1400),
    ("battle-royale-uhd", "00002", 0x1400),
    ("battle-royale-uhd", "00005", 0x1400),
    ("kyoani-ova", "00005", 0x1400),
    ("synthetic-igs-parser", "00001", 0x120),
    ("tamako", "00005", 0x1400),
    ("tamako", "00043", 0x1400),
]

REVISION = "d75c88e54c893e5cbf4c61d356477655eb435769"


def run(*args: str, env: dict[str, str] | None = None) -> str:
    return subprocess.run(args, check=True, capture_output=True, text=True, env=env).stdout


def libdir() -> Path:
    try:
        return Path(run("pkg-config", "--variable=libdir", "libbluray").strip())
    except (FileNotFoundError, subprocess.CalledProcessError):
        for candidate in (Path("/opt/homebrew/lib"), Path("/usr/local/lib"), Path("/usr/lib")):
            if (candidate / "libbluray.a").exists():
                return candidate
    raise RuntimeError("libbluray static archive not found")


def compile_tools(work: Path) -> tuple[Path, Path]:
    ld = libdir()
    static = ld / "libbluray.a"
    if not static.exists():
        raise RuntimeError(f"missing {static}; the internal decoder symbols are not exported by the dylib")

    igs_dump = work / "libbluray-igs-dump"
    subprocess.run([
        "clang", "-O2", "-o", str(igs_dump),
        f"-I{LIBBLURAY_SRC / 'libbluray'}", f"-I{LIBBLURAY_SRC}", f"-I{ld.parent / 'include'}",
        str(IGS_DUMP_SRC), str(static),
        f"-L{ld}", "-lxml2", "-lz", "-lbz2", "-liconv", "-lfreetype", "-ludfread",
        "-framework", "CoreFoundation", "-framework", "DiskArbitration",
    ], check=True)

    mobj_dump = work / "libbluray-mobj-dump"
    subprocess.run([
        "clang", "-O2", "-o", str(mobj_dump),
        f"-I{LIBBLURAY_SRC}", f"-I{LIBBLURAY_SRC / 'libbluray'}", f"-I{ld.parent / 'include'}",
        str(LIBBLURAY_SRC / "devtools" / "mobj_dump.c"),
        str(LIBBLURAY_SRC / "libbluray" / "hdmv" / "mobj_print.c"),
        f"-L{ld}", "-lbluray",
    ], check=True)
    return igs_dump, mobj_dump


def ig_packet_source(case: str, clip: str) -> Path:
    if case == "synthetic-igs-parser":
        return ROOT / "test-data" / "fixtures" / "igs-parser" / "synthetic-single-object.m2ts"
    return CORPUS_ROOT / case / "BDMV" / "STREAM" / f"{clip}.m2ts_ig-packets.bin"


def repack_units(path: Path, work: Path, key: str) -> Path:
    """Group the filtered 192-byte TS packets into libbluray 6144-byte read units."""
    data = path.read_bytes()
    if len(data) % 192:
        raise RuntimeError(f"{key}: packet fixture is not a multiple of 192 bytes")
    packets = len(data) // 192
    units = (packets + 31) // 32
    null_packet = b"\x00\x00\x00\x00\x47\x1f\xff\x10" + b"\xff" * 184
    out = work / f"{key}.units.bin"
    out.write_bytes(data + null_packet * (units * 32 - packets))
    return out


def generate_igs(igs_dump: Path, work: Path) -> dict:
    cases = []
    for case, clip, pid in IG_CASES:
        source = ig_packet_source(case, clip)
        units = repack_units(source, work, f"{case}-{clip}")
        raw = run(str(igs_dump), str(units), hex(pid))
        decoded = json.loads(raw)
        cases.append({
            "case": case,
            "clip": clip,
            "pid": pid,
            "displaySet": {
                "complete": decoded["complete"],
                "epochStart": decoded["epochStart"],
                "validPts": decoded["validPts"],
                "numPalette": decoded["numPalette"],
                "numObject": decoded["numObject"],
                "numWindow": decoded["numWindow"],
            },
            "ics": decoded["ics"],
            "palettes": decoded["palettes"],
            "objects": decoded["objects"],
        })
        print(f"  IGS {case}/{clip}: {decoded['numObject']} objects, {decoded['numPalette']} palettes")
    return {
        "reference": {
            "tool": "VideoLAN libbluray",
            "version": "1.5.0",
            "revision": REVISION,
            "decoder": "src/libbluray/decoders/graphics_processor.c (graphics_processor_decode_ts)",
            "input": "192-byte TS packets regrouped into 6144-byte read units; stc=-1 decodes every segment",
            "encoding": {
                "pages": "[id,version,paletteId,defaultSelected,defaultActivated,animationFrameRateCode,inEffects,outEffects,numBogs,bogs]",
                "effects": "[numWindows,numEffects,[[duration90k,paletteId,numObjects,[[objectId,windowId,forcedOn,x,y,cropFlag,cropX,cropY,cropW,cropH],...]],...]]",
                "bogs": "[defaultValidButtonId,numButtons,buttons]",
                "buttons": "[id,numeric,autoAction,x,y,up,down,left,right,normalStart,normalEnd,normalRepeat,selectedStart,selectedEnd,selectedRepeat,selectedSound,activatedStart,activatedEnd,activatedSound,numNavCmds]",
                "palettes": "[id,version,256 little-endian YCrCbT entries as hex]",
                "objects": "[id,version,width,height,rleRuns,endOfLines,firstNonZeroIndex,lastNonZeroIndex,48 evenly spaced palette indices as hex,16 index bins]",
            },
        },
        "cases": cases,
    }


INFO_KEYS = {
    "First Play supported": "firstPlay",
    "Top menu supported": "topMenu",
    "HDMV titles": "hdmvTitles",
    "BD-J titles": "bdjTitles",
    "UNSUPPORTED titles": "unsupportedTitles",
}


def parse_disc_info(text: str) -> dict:
    out = {}
    for label, key in INFO_KEYS.items():
        found = re.search(rf"^{re.escape(label)}\s*:\s*(yes|\d+)\s*$", text, re.M)
        if not found:
            raise RuntimeError(f"bd_info did not report {label}")
        out[key] = found.group(1) == "yes" if found.group(1) == "yes" else int(found.group(1))
    return out


TITLE_LINE = re.compile(
    r"^index:\s*(\d+)\s+duration:\s*(\S+)\s+chapters:\s*(\d+)\s+angles:\s*(\d+)\s+"
    r"clips:\s*(\d+)\s+\(playlist:\s*(\d+)\.mpls\)\s+V:(\d+)\s+A:(\d+)\s+PG:(\d+)\s+IG:(\d+)"
)


def parse_title_list(text: str) -> list[dict]:
    titles = []
    for line in text.splitlines():
        m = TITLE_LINE.match(line.strip())
        if not m:
            continue
        index, duration, chapters, angles, clips, playlist, v, a, pg, ig = m.groups()
        titles.append({
            "index": int(index), "duration": duration, "chapters": int(chapters),
            "angles": int(angles), "clips": int(clips), "playlist": int(playlist),
            "video": int(v), "audio": int(a), "pg": int(pg), "ig": int(ig),
        })
    if not titles:
        raise RuntimeError("bd_list_titles produced no title rows")
    return titles


MOBJ_COMMAND = re.compile(
    r"^\s{4}(\d{4}):\s+([0-9a-f]{8})\s+([0-9a-f]{8}),([0-9a-f]{8})\s+(.+?)\s*$"
)


def raw_command_word(printed: str) -> str:
    """Undo mobj_print.c's _cmd_to_u32() bitfield re-serialization.

    The dev tool prints the 32-bit value of the in-memory HDMV_INSN bitfield
    struct, not the on-disc word. On little-endian hosts the struct allocates
    sub_grp/op_cnt/grp in byte 0, branch_opt/imm flags in byte 1, cmp_opt in
    byte 2 and set_opt in byte 3. Rebuild the big-endian on-disc word so the
    golden can be compared byte-for-byte with MovieInstruction.bytes.
    """
    value = int(printed, 16)
    b0 = (value >> 24) & 0xff
    b1 = (value >> 16) & 0xff
    b2 = (value >> 8) & 0xff
    b3 = value & 0xff
    op_cnt = (b0 >> 3) & 7
    grp = (b0 >> 6) & 3
    sub_grp = b0 & 7
    imm_op1 = (b1 >> 7) & 1
    imm_op2 = (b1 >> 6) & 1
    branch_opt = b1 & 0x0f
    cmp_opt = b2 & 0x0f
    set_opt = b3 & 0x1f
    word = ((op_cnt << 29) | (grp << 27) | (sub_grp << 24) | (imm_op1 << 23) |
            (imm_op2 << 22) | (branch_opt << 16) | (cmp_opt << 8) | set_opt)
    return f"{word:08x}"


def parse_mobj_dump(text: str) -> list[dict]:
    objects: list[dict] = []
    current = None
    for line in text.splitlines():
        m = re.match(r"^Object (\d+):\s*$", line)
        if m:
            current = {"id": int(m.group(1)), "commands": []}
            objects.append(current)
            continue
        if current is None:
            continue
        for label, key in (("number of commands", "numCommands"),
                           ("resume intention flag", "resumeIntention"),
                           ("menu call mask", "menuCallMask"),
                           ("title search mask", "titleSearchMask")):
            m = re.match(rf"^\s+{label}:\s*(\d+)\s*$", line)
            if m:
                current[key] = int(m.group(1))
        m = MOBJ_COMMAND.match(line)
        if m:
            pc, w0, w1, w2, disasm = m.groups()
            disasm = re.sub(r"/\*.*?\*/\s*$", "", disasm).strip()
            mnemonic = disasm.split(" ", 1)[0]
            current["commands"].append({
                "pc": int(pc),
                "bytes": f"{raw_command_word(w0)}{w1}{w2}",
                "opcode": OPCODE_MAP.get(mnemonic),
                "disasm": disasm,
            })
    for obj in objects:
        if obj.get("numCommands") != len(obj["commands"]):
            raise RuntimeError(f"object {obj['id']}: command count mismatch")
    return objects


# libbluray's mobj_print.c mnemonics -> this project's OpcodeName.
OPCODE_MAP = {
    "nop": "NOP", "goto": "GOTO", "break": "BREAK",
    "JUMP_OBJECT": "JUMP_OBJECT", "JUMP_TITLE": "JUMP_TITLE",
    "CALL_OBJECT": "CALL_OBJECT", "CALL_TITLE": "CALL_TITLE", "RESUME": "RESUME",
    "PLAY_PL": "PLAY_PL", "PLAY_PL_PI": "PLAY_PL_PI", "PLAY_PL_MK": "PLAY_PL_PM",
    "TERMINATE_PL": "TERMINATE_PL", "LINK_PI": "LINK_PI", "LINK_MK": "LINK_MK",
    "bc": "BC", "eq": "EQ", "ne": "NE", "ge": "GE", "gt": "GT", "le": "LE", "lt": "LT",
    "move": "MOVE", "swap": "SWAP", "add": "ADD", "sub": "SUB", "mul": "MUL",
    "div": "DIV", "mod": "MOD", "rnd": "RND", "and": "AND", "or": "OR", "xor": "XOR",
    "bset": "BITSET", "bclr": "BITCLR", "shl": "SHL", "shr": "SHR",
    "SET_STREAM": "SET_STREAM", "SET_NV_TIMER": "SET_NV_TIMER",
    "SET_BUTTON_PAGE": "SET_BUTTON_PAGE", "ENABLE_BUTTON": "ENABLE_BUTTON",
    "DISABLE_BUTTON": "DISABLE_BUTTON", "SET_SEC_STREAM": "SET_SEC_STREAM",
    "POPUP_OFF": "POPUP_OFF", "STILL_ON": "STILL_ON", "STILL_OFF": "STILL_OFF",
    "SET_OUTPUT_MODE": "SET_OUTPUT_MODE", "SET_STREAM_SS": "SET_STREAM_SS",
    "[SETSYSTEM_0x10]": "SETSYSTEM_0x10",
}

TERMINATES = {"GOTO", "BREAK", "JUMP_OBJECT", "JUMP_TITLE", "CALL_OBJECT", "CALL_TITLE",
              "RESUME", "PLAY_PL", "PLAY_PL_PI", "PLAY_PL_PM", "LINK_PI", "LINK_MK",
              "TERMINATE_PL"}
CONDITIONALS = {"BC", "EQ", "NE", "GE", "GT", "LE", "LT"}


def operand_value(text: str) -> tuple[str, int | None]:
    """Parse the first operand of a libbluray disassembly line."""
    first = text.strip().split(",")[0].strip()
    if re.fullmatch(r"0x[0-9a-fA-F]+", first):
        return "immediate", int(first, 16)
    if re.fullmatch(r"\d+", first):
        return "immediate", int(first, 10)
    return "register", None


def derive_graph(objects: list[dict], index: dict) -> list[list]:
    """Independently derive the CFG from libbluray's disassembly.

    Nodes/edges follow the control-flow meaning of libbluray's own mnemonics;
    the derived edges are compared with this project's buildNavigationGraph.
    """
    object_ids = {o["id"] for o in objects}
    titles = index["titleIdRefs"]
    first_play = index["firstPlayIdRef"]
    top_menu = index["topMenuIdRef"]
    edges: list[list] = []

    def add(frm: str, to: str | None, kind: str, resolution: str) -> None:
        edges.append([frm, to, kind, resolution])

    for obj in objects:
        oid = obj["id"]
        length = obj["numCommands"]
        for cmd in obj["commands"]:
            pc = cmd["pc"]
            frm = f"command:{oid}:{pc}"
            mnemonic, _, rest = cmd["disasm"].partition(" ")
            opcode = OPCODE_MAP.get(mnemonic)
            kind, value = operand_value(rest)
            if opcode is None:
                add(frm, None, "unknown", "unresolved")
                continue

            if opcode == "GOTO":
                target = value if kind == "immediate" and value is not None and value < length else None
                add(frm, f"command:{oid}:{target}" if target is not None else None, "jump",
                    "resolved" if target is not None else "unresolved")
            elif opcode in ("JUMP_OBJECT", "CALL_OBJECT"):
                target = value if kind == "immediate" and value in object_ids else None
                add(frm, f"object:{target}" if target is not None else None,
                    "call" if opcode == "CALL_OBJECT" else "jump",
                    "resolved" if target is not None else "unresolved")
            elif opcode in ("PLAY_PL", "PLAY_PL_PI", "PLAY_PL_PM"):
                target = value if kind == "immediate" and value is not None and value <= 99999 else None
                add(frm, f"playlist:{target:05d}" if target is not None else None, "play",
                    "resolved" if target is not None else "unresolved")
                if pc + 1 < length:
                    add(frm, f"command:{oid}:{pc + 1}", "sequence", "resolved")
            elif opcode in ("JUMP_TITLE", "CALL_TITLE"):
                title = value if kind == "immediate" else None
                ref = None
                if title == 0:
                    ref = top_menu
                elif title == 0xffff:
                    ref = first_play
                elif title is not None and title > 0 and title <= len(titles):
                    ref = titles[title - 1]
                target = ref if ref in object_ids else None
                add(frm, f"object:{target}" if target is not None else None,
                    "call" if opcode == "CALL_TITLE" else "jump",
                    "resolved" if target is not None else "unresolved")
                if opcode == "CALL_TITLE" and pc + 1 < length:
                    add(frm, f"command:{oid}:{pc + 1}", "sequence", "resolved")
            elif opcode in ("LINK_PI", "LINK_MK"):
                add(frm, None, "play", "unresolved")
            elif opcode == "RESUME":
                add(frm, None, "resume", "unresolved")
            elif opcode in CONDITIONALS:
                add(frm, f"command:{oid}:{pc + 1}", "conditional", "unresolved")
                add(frm, f"command:{oid}:{pc + 2}", "conditional", "unresolved")

            if opcode not in TERMINATES and pc + 1 < length:
                add(frm, f"command:{oid}:{pc + 1}", "sequence", "resolved")
    return edges


def libbluray_index(root: Path) -> dict:
    """Read the index through libbluray's own bd_get_disc_info (not our parser)."""
    sys.path.insert(0, str(CACHE / "bdmvkit-0.7.0" / "tests"))
    import bluray_sim  # pylint: disable=import-outside-toplevel

    lib = bluray_sim.load_library()
    if not lib:
        raise RuntimeError("libbluray not found")
    with bluray_sim.Disc(lib, str(root)) as disc:
        info = lib.bd_get_disc_info(disc.bd).contents
        # _fill_disc_info() reserves titles[0] for Top Menu and
        # titles[num_titles+1] for First Play, so index titles start at 1.
        titles = [info.titles[i + 1].contents.id_ref for i in range(info.num_titles)]
        first = info.first_play.contents.id_ref if info.first_play else None
        top = info.top_menu.contents.id_ref if info.top_menu else None
        events = disc.play(max_bytes=4 * 1024 * 1024)
    return {
        "titleIdRefs": titles,
        "firstPlayIdRef": first,
        "topMenuIdRef": top,
        "vmPlaylists": sorted({int(value) for name, value in events if name == "playlist"}),
        "vmTitles": [int(value) for name, value in events if name == "title"],
    }


def generate_navigation(mobj_dump: Path) -> dict:
    cases = []
    for case in NAVIGATION_CASES:
        root = CORPUS_ROOT / case
        info = parse_disc_info(run("bd_info", str(root)))
        titles = parse_title_list(run("bd_list_titles", "-a", str(root)))
        objects = parse_mobj_dump(run(str(mobj_dump), "-d", str(root / "BDMV" / "MovieObject.bdmv")))
        index = libbluray_index(root)
        graph = derive_graph(objects, index)
        cases.append({
            "case": case,
            "discInfo": info,
            "titles": titles,
            "index": {k: v for k, v in index.items() if k in ("titleIdRefs", "firstPlayIdRef", "topMenuIdRef")},
            "vmTrace": {"playlists": index["vmPlaylists"], "titles": index["vmTitles"]},
            "objects": objects,
            "graph": graph,
        })
        print(f"  NAV {case}: {len(objects)} objects, {sum(o['numCommands'] for o in objects)} commands, "
              f"{len(graph)} edges, libbluray VM playlists {index['vmPlaylists']}")
    return {
        "reference": {
            "tool": "VideoLAN libbluray",
            "version": "1.5.0",
            "revision": REVISION,
            "commands": [
                "bd_info <disc>",
                "bd_list_titles -a <disc>",
                "mobj_dump -d <disc>/BDMV/MovieObject.bdmv (built from the pinned source)",
                "bd_get_disc_info + bd_play/bd_read_ext (ctypes, navigation events)",
            ],
            "encoding": {
                "objects": "each command holds [pc, on-disc 12-byte hex, normalized opcode, libbluray disassembly text]",
                "graph": "[from,to,kind,resolution] derived from libbluray's own mnemonics and the index it parsed",
                "vmTrace": "PLAYLIST/TITLE events emitted by libbluray's HDMV VM during bd_play",
            },
        },
        "cases": cases,
    }


def main() -> None:
    if not LIBBLURAY_SRC.exists():
        raise RuntimeError("run scripts/fetch-reference-cache.py first")
    with tempfile.TemporaryDirectory(prefix="libbluray-baseline-") as tmp:
        work = Path(tmp)
        print("Compiling libbluray evidence tools...")
        igs_dump, mobj_dump = compile_tools(work)
        print("Decoding IG display sets...")
        igs = generate_igs(igs_dump, work)
        print("Reading navigation structures and running the libbluray HDMV VM...")
        navigation = generate_navigation(mobj_dump)
    EVIDENCE.mkdir(parents=True, exist_ok=True)
    for name, payload in (("libbluray-1.5.0-igs-baseline.json", igs),
                          ("libbluray-1.5.0-navigation-baseline.json", navigation)):
        path = EVIDENCE / name
        path.write_text(json.dumps(payload, separators=(",", ":"), ensure_ascii=False) + "\n")
        print(f"wrote {path.relative_to(ROOT)} ({path.stat().st_size} bytes)")


if __name__ == "__main__":
    main()

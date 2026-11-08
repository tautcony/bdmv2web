#!/usr/bin/env python3
"""Extract per-element RGBA summaries from the igstools reference PNGs.

Reads <reference_root>/<case>/<clip>/reference/*.png, applies the same
summaries as packages/igs/tests/integration/igs-reference-element-summary.test.ts
(48 evenly spaced RGBA samples, 3x3 fixed-grid anchors, first/last opaque
pixel, 64 high-nibble channel bins), and merges one case entry per clip into
the summary JSON. Case lines not named in --case are kept byte-identical.

Needs pypng-free dependencies only: Pillow. The pinned igstools checkout and
the reference PNGs under .reference-cache/verification/ are produced by
scripts/compare-igstools-reference.py.

Usage:
  python3 scripts/summarize-igstools-references.py REFERENCE_ROOT SUMMARY_JSON \
      --case synthetic-all-features:00002 [--case CASE:CLIP ...]
"""

from __future__ import annotations

import argparse
import json
import re
from pathlib import Path

from PIL import Image

SAMPLE_COUNT = 48


def pixel_hex(data: bytes, index: int) -> str:
    base = index * 4
    return "".join(f"{data[base + channel]:02x}" for channel in range(4))


def summarize_png(path: Path, asset_id: str) -> list:
    image = Image.open(path).convert("RGBA")
    width, height = image.size
    data = image.tobytes()
    count = width * height
    bins = [0] * 64
    first_opaque = None
    last_opaque = None
    for index in range(count):
        base = index * 4
        for channel in range(4):
            bins[channel * 16 + (data[base + channel] >> 4)] += 1
        if data[base + 3]:
            anchor = [index % width, index // width, pixel_hex(data, index)]
            if first_opaque is None:
                first_opaque = anchor
            last_opaque = anchor
    samples = "".join(pixel_hex(data, k * (count - 1) // (SAMPLE_COUNT - 1)) for k in range(SAMPLE_COUNT))
    anchors = "".join(
        pixel_hex(data, (height - 1) * gy // 2 * width + (width - 1) * gx // 2)
        for gy in range(3)
        for gx in range(3)
    )
    return [asset_id, width, height, count, samples, anchors, first_opaque, last_opaque, bins]


def case_line(case: str, clip: str, assets: list) -> str:
    entry = {"case": case, "clip": clip, "assets": assets}
    return "    " + json.dumps(entry, separators=(",", ":"))


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("reference_root", type=Path)
    parser.add_argument("summary_json", type=Path)
    parser.add_argument("--case", action="append", required=True, help="CASE:CLIP pair to (re)generate")
    args = parser.parse_args()

    targets = {}
    for pair in args.case:
        case, clip = pair.split(":")
        directory = args.reference_root / case / clip / "reference"
        pngs = sorted(directory.glob("*.png"))
        if not pngs:
            raise RuntimeError(f"no reference PNGs under {directory}")
        assets = [summarize_png(path, path.stem) for path in pngs]
        targets[(case, clip)] = case_line(case, clip, assets)

    text = args.summary_json.read_text()
    lines = text.splitlines(keepends=True)
    case_pattern = re.compile(r'^    \{"case":"([^"]+)","clip":"([^"]+)"')
    case_index = next(i for i, line in enumerate(lines) if case_pattern.match(line))
    entries = []
    for i, line in enumerate(lines[case_index:], start=case_index):
        match = case_pattern.match(line)
        if not match:
            entries.append((None, i))
            continue
        entries.append(((match.group(1), match.group(2)), i))
        if line.rstrip("\n").endswith("]]}"):
            break

    for (case, clip), new_line in targets.items():
        position = next(((key, i) for key, i in entries if key is not None and key > (case, clip)), None)
        existing = next(((key, i) for key, i in entries if key == (case, clip)), None)
        if existing:
            original = lines[existing[1]]
            lines[existing[1]] = new_line + ("," if original.endswith(",\n") else "\n")
        elif position:
            lines.insert(position[1], new_line + ",\n")
        else:
            lines.insert(entries[-1][1], new_line + "\n")

    args.summary_json.write_text("".join(lines))
    print(f"merged {len(targets)} case entries into {args.summary_json}")


if __name__ == "__main__":
    main()

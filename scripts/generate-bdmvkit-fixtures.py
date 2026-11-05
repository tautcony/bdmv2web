#!/usr/bin/env python3
"""Generate the checked-in interoperability disc using pinned cached bdmvkit."""
from __future__ import annotations

import os
import shutil
import subprocess
import sys
import tempfile
import zlib
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CACHE = ROOT / ".reference-cache" / "repositories" / "bdmvkit-0.7.0"
OUTPUT = ROOT / "test-data" / "fixtures" / "bdmvkit-generated"

sys.path.insert(0, str(CACHE))
from bdmvkit import Disc, MenuButton  # noqa: E402
from bdmvkit import encode, pgs  # noqa: E402


def run(args: list[str]) -> str:
    result = subprocess.run(args, check=True, capture_output=True, text=True)
    return result.stdout.splitlines()[0] if result.stdout else ""


def png(path: Path, width: int, height: int, rgba: tuple[int, int, int, int]) -> None:
    raw = b"".join(b"\0" + bytes(rgba) * width for _ in range(height))

    def chunk(kind: bytes, data: bytes) -> bytes:
        body = kind + data
        return len(data).to_bytes(4, "big") + body + (zlib.crc32(body) & 0xffffffff).to_bytes(4, "big")

    path.write_bytes(b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", width.to_bytes(4, "big") + height.to_bytes(4, "big") + bytes([8, 6, 0, 0, 0])) + chunk(b"IDAT", zlib.compress(raw, 9)) + chunk(b"IEND", b""))


def main() -> None:
    ffmpeg = shutil.which("ffmpeg")
    ffprobe = shutil.which("ffprobe")
    if not ffmpeg or not ffprobe:
        raise SystemExit("fixture generation requires ffmpeg and ffprobe on PATH")
    if not (CACHE / "bdmvkit" / "disc.py").is_file():
        raise SystemExit("pinned bdmvkit cache is missing; run python3 scripts/fetch-reference-cache.py")

    with tempfile.TemporaryDirectory(prefix="bdmvkit-fixture-") as tmp:
        work = Path(tmp)
        source = work / "source.mkv"
        run([ffmpeg, "-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi", "-i", "testsrc2=size=160x90:rate=24000/1001:duration=1.0", "-f", "lavfi", "-i", "anullsrc=channel_layout=stereo:sample_rate=48000", "-shortest", "-c:v", "libx264", "-preset", "ultrafast", "-crf", "32", "-pix_fmt", "yuv420p", "-c:a", "ac3", "-b:a", "96k", str(source)])

        subtitle = work / "english.sup"
        subtitle_fr = work / "french.sup"
        rgba = bytes([255, 255, 255, 255]) * (96 * 24)
        picture = pgs.indexed(rgba, 96, 24)
        rgba_fr = bytes([255, 220, 40, 255]) * (88 * 22)
        picture_fr = pgs.indexed(rgba_fr, 88, 22)
        pgs.write_sup(str(subtitle), [
            (0.20, 0.55, picture, pgs.palette("#ffffff", "#000000")),
            (0.70, 0.98, picture, pgs.palette("#ffffff", "#000000")),
        ], (1920, 1080))
        pgs.write_sup(str(subtitle_fr), [(0.35, 0.82, picture_fr, pgs.palette("#ffdc28", "#101010"))], (1920, 1080))

        title_clip = work / "title.m2ts"
        encode.encode_clip(str(source), str(title_clip), fps=(24000, 1001), chapters=(0, 0.25, 0.55, 0.8), audio=[encode.AudioTrack(codec="ac3", channels=2), encode.AudioTrack(codec="ac3", channels=2)], sups=[str(subtitle), str(subtitle_fr)], fast=True)

        normal = work / "button.png"
        selected = work / "button-selected.png"
        popup_selected = work / "popup-selected.png"
        normal_alt = work / "button-alt.png"
        selected_alt = work / "button-alt-selected.png"
        popup_audio = work / "popup-audio.png"
        png(normal, 240, 72, (30, 70, 160, 220))
        png(selected, 240, 72, (240, 190, 20, 255))
        png(popup_selected, 260, 72, (190, 35, 35, 230))
        png(normal_alt, 220, 64, (25, 125, 70, 220))
        png(selected_alt, 220, 64, (90, 220, 130, 255))
        png(popup_audio, 240, 64, (60, 80, 170, 230))

        disc = Disc()
        first = disc.add_title(str(title_clip), fps=(24000, 1001), chapters=(0, 0.25, 0.55, 0.8), audio=[("ac3", 2, "eng"), ("ac3", 2, "fra")], subtitles=["eng", "fra"], default_audio=1, default_subtitle=1, end="menu:main")
        second = disc.add_title(str(title_clip), fps=(24000, 1001), chapters=(0,), audio=[("ac3", 2, "eng")], end="menu:main")
        disc.add_playlist("shuffle", [first, second, second], order="shuffle", end="menu:main")
        buttons = [
            MenuButton("play-shuffle", 120, 610, str(selected), str(selected), str(normal), action="playlist:shuffle", nav={"down": "play-feature"}),
            MenuButton("play-feature", 120, 700, str(selected_alt), str(selected_alt), str(normal_alt), action="playlist:feature", nav={"up": "play-shuffle", "down": "play-third"}),
            MenuButton("play-third", 120, 790, str(selected), str(selected), str(normal), action="title:2", nav={"up": "play-feature"}),
        ]
        disc.add_menu("main", str(source), buttons, default="play-shuffle", fps=(24000, 1001), loop_point=0.5)
        disc.add_playlist("feature", [(first, 1, 2), second], order="sequential", end="menu:main")
        disc.add_popup(first, [
            MenuButton("popup-main", 80, 80, str(popup_selected), action="menu:main", nav={"right": "popup-audio"}),
            MenuButton("popup-audio", 360, 80, str(popup_audio), action="subtitle:2", nav={"left": "popup-main"}),
        ], default="popup-main")
        OUTPUT.parent.mkdir(parents=True, exist_ok=True)
        if OUTPUT.exists():
            shutil.rmtree(OUTPUT)
        disc.write(str(OUTPUT), fast=True)
        pgs_dir = OUTPUT / "pgs"
        pgs_dir.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(subtitle, pgs_dir / "english.sup")

    print(f"generated BDMV fixture at {OUTPUT}")


if __name__ == "__main__":
    main()

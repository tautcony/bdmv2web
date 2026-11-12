# bdmv2web

English | [简体中文](README.zh-CN.md)

[![npm version](https://img.shields.io/npm/v/bdmv2web)](https://www.npmjs.com/package/bdmv2web)
[![node](https://img.shields.io/node/v/bdmv2web)](https://nodejs.org)
[![license](https://img.shields.io/badge/license-GPL--3.0--only-blue)](LICENSE)

Inspect a Blu-ray BDMV disc and build a web menu package for HDMV and BD-J discs.

`bdmv2web` reads a Blu-ray BDMV directory and writes a local package with menu navigation, media, graphics, and sound effects. HDMV packages open directly from `file://`. BD-J packages run through the local `serve` command, a Java runtime, and a loopback HTTP URL.

- Build a menu package with menu navigation, background video, audio tracks, button graphics, and sound effects.
- Run BD-J Xlets from packaged application JARs with a local Java process.
- Package BD-J accessible Playlist video and audio for browser playback. `build --overwrite` and `build --resume` reuse matching media assets.
- Inspect BDMV structure and export HDMV, IGS, and SUP data together with menu assets.
- Hand off supported whole-file feature playback to the system player.
- Audit package structure, references, paths, and dependencies; produce a compatibility report.

## Table of Contents

- [Install](#install)
  - [Dependencies](#dependencies)
  - [From npm](#from-npm)
  - [From source](#from-source)
- [Usage](#usage)
  - [HDMV and BD-J playback](#hdmv-and-bd-j-playback)
  - [CLI](#cli)
  - [Player profile](#player-profile)
- [Development](#development)
  - [Repository layout](#repository-layout)
- [Documentation](#documentation)
- [Maintainers](#maintainers)
- [License](#license)

## Install

### Dependencies

| Dependency | Version or requirement | Purpose |
| --- | --- | --- |
| Node.js | `>=22` | Run the commands |
| Node.js | `24.18.0` (`.node-version`) | Build from source |
| pnpm | `11.25.0`, invoked through `corepack pnpm` | Install dependencies and run scripts |
| ffmpeg | Callable from `PATH`, with `libx265`, `libx264`, and `aac` | Encode menu background video and audio |
| ffprobe | Callable from `PATH` | Read menu media metadata |
| Java runtime | Java 21 or compatible with `java.desktop`; BD-J packages only | Run packaged BD-J Xlets with `serve` |

Background video is encoded with `libx265` (HEVC) at `crf` 24 by default; `--codec h264` uses H.264 at `crf` 18. `build --video copy` remuxes the source video stream into MP4 and keeps the source bitrate. Audio is encoded to AAC. A remux requires an 8-bit 4:2:0 SDR H.264 source and a PlayItem in-time that names a decode entry point within the 5.689 ms entry-point map grid; other clips are encoded (H.264 when `--codec` is omitted) and the media plan records a `MEDIA_REMUX_UNAVAILABLE` warning. HDR sources are tone mapped to SDR BT.709 by default through FFmpeg's `zscale` filter (libzimg). FFmpeg builds without `zscale` produce a package with the HDR tag preserved and a `MEDIA_HDR_TONEMAP_UNAVAILABLE` warning in diagnostics.

Menu media is scoped by `--menu-media auto|all|none` for HDMV and BD-J packages: `auto` (default) exports the playlists a menu uses — HDMV playlists matched by an IGS scene, BD-J playlists of at most 15 minutes; `all` exports every reachable playlist; `none` packages a menu without playlist media and the runtime reports `PLAY_PLAYLIST` as unavailable. Playlists skipped by `auto` are listed in a `M5_MENU_MEDIA_SCOPE_SKIPPED` diagnostic.

### From npm

Install globally; the command is `bdmv2web`:

```sh
npm install -g bdmv2web
bdmv2web --version
```

### From source

```sh
corepack pnpm install --frozen-lockfile
corepack pnpm generate:contracts
corepack pnpm build
corepack pnpm bundle:cli
```

After building from source, `apps/cli/dist/index.js` is the executable entry point. Inside the repository, call the CLI with `corepack pnpm run cli:dev <command> [options]`.

## Usage

Convert a BDMV directory into a menu package:

```sh
bdmv2web build /path/to/BDMV --out ./BDMV-menu
```

Open an HDMV package from `BDMV-menu/index.html`; start a BD-J package with `bdmv2web serve ./BDMV-menu`. Keep the whole output directory when copying or moving the menu.

Validate the generated menu package:

```sh
bdmv2web validate ./BDMV-menu
```

`validate` audits package structure, references, paths, and dependencies and updates the audit report.

### HDMV and BD-J playback

Open an HDMV package directly from `BDMV-menu/index.html`. Its menu media is stored in the package. Feature playback uses the configured external player adapter. A background item with `loop=false` holds its final decoded frame.

Build exports BD-J accessible Playlist PlayItems as MP4 video and AAC audio assets in the output directory. Equivalent media references share assets. With `--overwrite`, matching media plans reuse existing assets from the output directory; changed source ranges or encoding settings are exported again. `--resume [DIR]` reads that reuse source from a directory an interrupted run left behind: `DIR` when given, otherwise the newest `.<output name>.staging-*` beside the output target. Reused assets are probed, and one whose duration differs from its media plan by more than 0.25s is exported again. The directory is an optional value; write the input before the flag or use `--resume=DIR`.

Run a BD-J package with a local Java runtime:

```sh
bdmv2web serve ./BDMV-menu [--port 4173] [--java <executable>]
```

Open the loopback URL printed by `serve`. A BD-J page opened with `file://` displays this launch command. `--player system` opens supported whole-file targets and reports each launch as `requested`. Bounded and multi-item targets return `EXTERNAL_PLAYER_CAPABILITY_UNAVAILABLE` with their source. The system player owns feature playback state.

### CLI

`<BDMV>` may point to a BDMV directory or to a parent directory that contains `BDMV/`.

| Command | Purpose | Common options |
| --- | --- | --- |
| `inspect <BDMV>` | Show disc structure and diagnostics | `--format table\|json`, `--out FILE`, `--strict` |
| `extract <BDMV> --out DIR` | Export HDMV, IGS, and SUP analysis data | `--type hdmv\|igs\|sup` or `--all` |
| `list <BDMV>` | List exportable IGS and SUP assets | `--type all\|igs\|sup`, `--m2ts CLIP_ID`, `--pid PID`, `--format table\|json` |
| `export <BDMV> --out DIR` | Export raw `.mnu` and `.sup` assets | `--type all\|igs\|sup`, `--m2ts CLIP_ID`, `--pid PID`, `--decode png`, `--png-level 0-9` |
| `render <input>` | Render PNG from a BDMV, `.mnu`, or `.sup` | `--out DIR`, `--type all\|igs\|sup`, `--mnu FILE`, `--sup FILE`, `--language LANG`, `--png-level 0-9` |
| `build <BDMV>` | Build a menu package | `--out DIR`, `--title NAME`, `--player-profile FILE`, `--codec hevc\|h264`, `--crf N`, `--preset NAME`, `--hdr tonemap\|preserve`, `--video encode\|copy`, `--menu-media auto\|all\|none`, `--png-level 0-9`, `--overwrite`, `--resume [DIR]`, `--strict` |
| `validate <menu dir>` | Audit a menu package and update the audit report | `--format json`, `--strict` |
| `serve <package dir>` | Serve a generated package and run its BD-J Java session | `--port N`, `--java EXECUTABLE`, `--player system`, `--disc-id HEX` |

`build` writes to `<BDMV parent>/BDMV-menu` by default. Use `--overwrite` when the output directory already exists. An interrupted run keeps completed work in `.<output name>.staging-*`; `--resume` continues from that directory. The output target is written when the build completes. Movie PGS subtitles are exported with `export --type sup`.

Values for `--m2ts` and `--pid` can be looked up with `list`. `list` reports IGS scene and reachable SUP track metadata. `export --decode png` writes PNG files alongside the raw assets. `render` accepts a BDMV, `.mnu`, or `.sup` input. `--png-level 0-9` sets the deflate level for written PNGs; the default is level 1 for IGS elements and level 6 for PGS canvases.

`sup-png` entries in `assets-manifest.json` record `displaySet`, `startSeconds`, `endSeconds`, `width`, and `height`. `startSeconds` is where the display set starts and `endSeconds` is where the next display set starts, in seconds with 3 decimals relative to the start of the track; both are `null` when they cannot be determined. Fully transparent display sets are omitted from PNG output and the manifest.

`convert` is an alias of `build`. `bdmv2web --help` lists every command and `bdmv2web <command> --help` lists the options of one command.

The exit code is 0 on success and 1 on failure; with `--strict`, a partially completed result exits with 2. See the [development guide](docs/guides/development.md) for the full option list, output files, and error codes.

### Player profile

Use `build --player-profile FILE` to set menu language, audio language, subtitle language, region, and playback profile:

```json
{
  "menuLanguage": "jpn",
  "audioLanguage": "jpn",
  "subtitleLanguage": "eng",
  "country": "JP",
  "region": "A",
  "outputProfile": "portable",
  "videoProfiles": ["1080p"],
  "audioProfiles": ["stereo"]
}
```

| Field | Required | Value | Default |
| --- | --- | --- | --- |
| `menuLanguage` | yes | 3 ASCII letters (PSR18) | `eng` |
| `audioLanguage` | yes | 3 ASCII letters (PSR16) | `eng` |
| `subtitleLanguage` | yes | 3 ASCII letters (PSR17) | `eng` |
| `country` | yes | 2 ASCII letters (PSR19) | `US` |
| `region` | yes | `A` / `B` / `C` | `A` |
| `outputProfile` | yes | `portable` | `portable` |
| `videoProfiles` | no | Array of strings | `[]` |
| `audioProfiles` | no | Array of strings | `[]` |

## Development

```sh
corepack pnpm build                              # Compile runtime code
corepack pnpm run cli:dev inspect /path/to/BDMV  # Run the CLI directly
corepack pnpm lint                               # ESLint and Java lint
corepack pnpm lint:fix                           # Apply ESLint fixes
corepack pnpm lint:java                          # Check BD-J host Java style and Java 8 compilation
corepack pnpm typecheck                          # Type checking
corepack pnpm test                               # Run tests
corepack pnpm test:all                           # Run all tests and collect failures
corepack pnpm test:coverage                      # Run tests and report source coverage
bash scripts/ci.sh                               # Run the full CI check
```

`corepack pnpm lint:java` requires JDK 21 or newer and downloads the pinned Checkstyle release on first use.

Run tests for a single package:

```sh
corepack pnpm --filter @bdmv2web/igs test
```

Fetch the local reference source cache:

```sh
python3 scripts/fetch-reference-cache.py
```

### Repository layout

| Path | Responsibility |
| --- | --- |
| `apps/cli` | Command-line entry point |
| `packages/core` | DiscIR schema, generated types, player profile, and shared utilities |
| `packages/utils` | Shared browser-compatible utilities and Node path and filesystem utilities |
| `packages/bdmv-io` | Input discovery, file reading, and output transactions |
| `packages/bdmv-parser` | BDMV file parsing and the reference graph |
| `packages/hdmv` | HDMV instructions, navigation graph, and virtual machine |
| `packages/igs` | Transport stream reassembly, IGS scene extraction, and PNG encoding |
| `packages/media-export` | Menu media export, timeline, and external playback targets |
| `packages/runtime-web` | Browser menu runtime |
| `packages/package-builder` | Menu package generation |
| `packages/test-runner` | Menu package validation, diagnostics, and delivery decisions |
| `packages/test-fixtures` | Test fixtures and byte builders |
| `test-data/` | Test fixtures, disc data, and output directories |

## Documentation

The [development guide](docs/guides/development.md) covers the toolchain, CLI details, and build process. BD-J runtime requirements and implemented operations are in the [BD-J support guide](docs/support/bdj-support.md). Protocol support boundaries are recorded in the [support documents](docs/support/protocol-support.md).

The [documentation index](docs/README.md) lists every guide, support matrix, and archived design or review record.

## Maintainers

- TautCony ([@tautcony](https://github.com/tautcony))

## License

[GPL-3.0-only](LICENSE). Copyright (C) 2026 TautCony.

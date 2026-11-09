# bdmv2web

English | [简体中文](README.zh-CN.md)

[![npm version](https://img.shields.io/npm/v/bdmv2web)](https://www.npmjs.com/package/bdmv2web)
[![node](https://img.shields.io/node/v/bdmv2web)](https://nodejs.org)
[![license](https://img.shields.io/badge/license-GPL--3.0--only-blue)](LICENSE)

Inspect a Blu-ray BDMV disc and build an offline web menu package.

`bdmv2web` reads a Blu-ray BDMV directory and writes a self-contained browser menu. The package holds menu navigation, background video, audio tracks, button graphics, and sound effects, and runs from the local filesystem without a web server or network access. The original M2TS files stay where they are and open in the system player from the menu.

- Build an offline menu package with menu navigation, background video, audio tracks, button graphics, and sound effects.
- Inspect BDMV structure and export HDMV, IGS, and SUP data together with menu assets.
- Open the original M2TS files referenced by the menu with an external player.
- Validate the offline dependencies of a menu package and produce a compatibility report.

## Table of Contents

- [Install](#install)
  - [Dependencies](#dependencies)
  - [From npm](#from-npm)
  - [From source](#from-source)
- [Usage](#usage)
  - [CLI](#cli)
  - [Player profile](#player-profile)
- [Development](#development)
  - [Repository layout](#repository-layout)
- [Documentation](#documentation)
- [Maintainers](#maintainers)
- [Contributing](#contributing)
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

Background video is encoded with `libx265` (HEVC) at `crf` 24 by default; pass `--codec h264` to use H.264 (`crf` defaults to 18). HDR sources are tone mapped to SDR BT.709 by default, which requires an FFmpeg build with the `zscale` filter (libzimg). Without it the package is still produced, but the HDR tag is preserved and a `MEDIA_HDR_TONEMAP_UNAVAILABLE` warning is reported in diagnostics (the picture appears washed out on SDR displays).

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

Convert a BDMV directory into an offline menu package:

```sh
bdmv2web build /path/to/BDMV --out ./BDMV-menu
```

Open `BDMV-menu/index.html` in a browser. Keep the whole output directory when copying or moving the menu.

Validate the generated menu package:

```sh
bdmv2web validate ./BDMV-menu --offline
```

### CLI

`<BDMV>` may point to a BDMV directory or to a parent directory that contains `BDMV/`.

| Command | Purpose | Common options |
| --- | --- | --- |
| `inspect <BDMV>` | Show disc structure and diagnostics | `--format table\|json`, `--out FILE`, `--strict` |
| `extract <BDMV> --out DIR` | Export HDMV, IGS, and SUP analysis data | `--type hdmv\|igs\|sup` or `--all` |
| `list <BDMV>` | List exportable IGS and SUP assets | `--type all\|igs\|sup`, `--m2ts CLIP_ID`, `--pid PID`, `--format table\|json` |
| `export <BDMV> --out DIR` | Export raw `.mnu` and `.sup` assets | `--type all\|igs\|sup`, `--m2ts CLIP_ID`, `--pid PID`, `--decode png` |
| `render <input>` | Render PNG from a BDMV, `.mnu`, or `.sup` | `--out DIR`, `--type all\|igs\|sup`, `--mnu FILE`, `--sup FILE`, `--language LANG` |
| `build <BDMV>` | Build the offline menu package | `--out DIR`, `--title NAME`, `--player-profile FILE`, `--codec hevc\|h264`, `--crf N`, `--preset NAME`, `--hdr tonemap\|preserve`, `--overwrite`, `--strict` |
| `validate <menu dir> --offline` | Validate a menu package and update the audit report | `--format json`, `--strict` |

`build` writes to `<BDMV parent>/BDMV-menu` by default. Use `--overwrite` when the output directory already exists. Movie PGS subtitles are exported with `export --type sup`.

Values for `--m2ts` and `--pid` can be looked up with `list`. `export --decode png` writes PNG files alongside the raw assets. `render` accepts a BDMV, `.mnu`, or `.sup` input.

`sup-png` entries in `assets-manifest.json` record `displaySet`, `startSeconds`, `endSeconds`, `width`, and `height`. `startSeconds` is where the display set starts and `endSeconds` is where the next display set starts, in seconds with 3 decimals relative to the start of the track; both are `null` when they cannot be determined. Fully transparent display sets produce no PNG and are not written to the manifest.

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
corepack pnpm lint                               # ESLint
corepack pnpm lint:fix                           # Apply ESLint fixes
corepack pnpm typecheck                          # Type checking
corepack pnpm test                               # Run tests
corepack pnpm test:all                           # Run all tests and collect failures
bash scripts/ci.sh                               # Run the full CI check
```

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
| `packages/bdmv-io` | Input discovery, file reading, hashing, and output transactions |
| `packages/bdmv-parser` | BDMV file parsing and the reference graph |
| `packages/hdmv` | HDMV instructions, navigation graph, and virtual machine |
| `packages/igs` | Transport stream reassembly, IGS scene extraction, and PNG encoding |
| `packages/media-export` | Menu media export, timeline, and external playback targets |
| `packages/runtime-web` | Browser menu runtime |
| `packages/package-builder` | Menu package generation and fingerprinting |
| `packages/test-runner` | Menu package validation, diagnostics, and delivery decisions |
| `packages/test-fixtures` | Test fixtures and byte builders |
| `test-data/` | Test fixtures, disc data, and output directories |

## Documentation

The [development guide](docs/guides/development.md) covers the toolchain, CLI details, and build process. Protocol support boundaries are recorded in the [support documents](docs/support/protocol-support.md).

The [documentation index](docs/README.md) lists every guide, support matrix, and archived design or review record.

## Maintainers

- TautCony ([@tautcony](https://github.com/tautcony))

## License

[GPL-3.0-only](LICENSE). Copyright (C) 2026 TautCony.

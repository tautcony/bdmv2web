# bdmv2web

Inspect a Blu-ray BDMV disc and build a web menu package.

`bdmv2web` reads a Blu-ray BDMV directory and writes a browser menu with navigation, background video, audio tracks, button graphics, and sound effects. HDMV packages open directly from `file://`. BD-J packages run with `bdmv2web serve` and a Java runtime. The menu can hand supported M2TS targets to the configured system player.

This package is the published CLI. The repository also holds the parser, HDMV virtual machine, IGS toolkit, menu runtime, and package validator behind it; see [full documentation](https://github.com/tautcony/bdmv2web#readme).

## Install

```sh
npm install -g bdmv2web
bdmv2web --version
```

### Dependencies

Node.js `>=22` is required. `ffmpeg` and `ffprobe` must be callable from `PATH` for media work: `ffmpeg` needs `libx265`, `libx264`, and `aac`, and HDR tone mapping additionally needs the `zscale` filter (libzimg).

## Usage

```sh
bdmv2web build /path/to/BDMV --out ./BDMV-menu
```

Open an HDMV package from `BDMV-menu/index.html`; start a BD-J package with `bdmv2web serve ./BDMV-menu`. Keep the whole output directory when copying or moving the menu.

```sh
bdmv2web validate ./BDMV-menu
```

### CLI

`<INPUT>` names a BDMV directory or a parent directory that contains `BDMV/`. `export` also takes a single `.m2ts`/`.rsks` stream file, and `render` also takes a stream file or a standalone `.mnu`/`.sup` file. The input kind is detected from the file itself.

| Command | Purpose |
| --- | --- |
| `inspect <INPUT>` | Show disc structure and diagnostics (`--format table\|json`, `--out FILE`, `--allow-partial`) |
| `list <INPUT>` | List exportable IGS and SUP assets (`--type all\|igs\|sup`, `--m2ts CLIP_ID`, `--pid PID`, `--out FILE`, `--format table\|json`) |
| `export <INPUT> --out DIR` | Export raw `.mnu` and `.sup` assets, optionally PNGs and metadata (`--type all\|metadata\|hdmv\|igs\|sup`, `--metadata-only`, `--m2ts CLIP_ID`, `--pid PID`, `--render`, `--png-level 0-9`, `--format table\|json`) |
| `render <INPUT> --out DIR` | Render PNG from a BDMV, a `.m2ts`/`.rsks` stream, `.mnu`, or `.sup` (`--type all\|igs\|sup`, `--language LANG`, `--png-level 0-9`, `--m2ts CLIP_ID`, `--pid PID`, `--format table\|json`) |
| `build <BDMV>` | Build a menu package (`--out DIR`, `--title NAME`, `--player-profile FILE`, `--limits FILE`, `--disc-id HEX`, `--codec hevc\|h264`, `--crf N`, `--preset NAME`, `--hdr tonemap\|preserve`, `--video encode\|copy`, `--menu-media auto\|all\|none`, `--overwrite`, `--no-reuse`, `--resume`, `--resume-dir DIR`) |
| `validate <menu dir>` | Audit a menu package and update the audit report (`--format json`) |
| `serve <package dir>` | Serve a generated package and run its BD-J Java session (`--port N`, `--java EXECUTABLE`, `--player system`, `--player-executable PATH`, `--disc-id HEX`) |
| `visualize <BDMV>` | Export the navigation graph as an interactive viewer and mermaid diagrams (`--out DIR`, `--programs IDS`, `--max-blocks N`, `--no-closure`, `--overwrite`, `--format table\|json`) |
| `compare <INPUT>` | Compare a VM trace against an independent reference trace (`--actual FILE` (required), `--reference FILE`, `--reference-tool NAME`, `--reference-version VERSION`, `--out FILE`, `--format json`) |

`export` and `render` require `--out DIR`. `build --overwrite` reuses matching media assets; `build --no-reuse` generates all menu media for that build. `--resume` reuses media from the newest `.<output name>.staging-*` directory beside the output target, and `--resume-dir DIR` names that directory. `--codec` defaults to `hevc` with CRF 24; a `--video copy` clip that needs encoding falls back to `h264` with CRF 18.

`export`, `render`, and `build` report progress on stderr; `--progress` forces step lines when stderr is piped, `--no-progress` keeps it silent.

`convert` is an alias of `build`. `bdmv2web --help` lists every command and `bdmv2web <command> --help` lists the options of one command.

The exit code is 0 on success and 1 on failure. Option lists, output files, error codes, and the `--player-profile` schema are documented in the [development guide](https://github.com/tautcony/bdmv2web/blob/master/docs/guides/development.md).

## Contributing

Questions, bug reports, and feature requests go to [GitHub Issues](https://github.com/tautcony/bdmv2web/issues). Pull requests against `master` are accepted.

## License

[GPL-3.0-only](https://github.com/tautcony/bdmv2web/blob/master/LICENSE). Copyright (C) 2026 TautCony.

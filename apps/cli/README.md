# bdmv2web

Inspect a Blu-ray BDMV disc and build an offline web menu package.

`bdmv2web` reads a Blu-ray BDMV directory and writes a self-contained browser menu: navigation, background video, audio tracks, button graphics, and sound effects. The package runs from the local filesystem without a web server or network access, and the original M2TS files open in the system player from the menu.

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

Open `BDMV-menu/index.html` in a browser. Keep the whole output directory when copying or moving the menu.

```sh
bdmv2web validate ./BDMV-menu --offline
```

### CLI

`<BDMV>` may point to a BDMV directory or to a parent directory that contains `BDMV/`.

| Command | Purpose |
| --- | --- |
| `inspect <BDMV>` | Show disc structure and diagnostics (`--format table\|json`, `--out FILE`, `--strict`) |
| `extract <BDMV> --out DIR` | Export HDMV, IGS, and SUP analysis data (`--type hdmv\|igs\|sup`, `--all`) |
| `list <BDMV>` | List exportable IGS and SUP assets (`--type`, `--m2ts CLIP_ID`, `--pid PID`) |
| `export <BDMV> --out DIR` | Export raw `.mnu` and `.sup` assets (`--type`, `--m2ts`, `--pid`, `--decode png`) |
| `render <input>` | Render PNG from a BDMV, `.mnu`, or `.sup` (`--out DIR`, `--type`, `--language LANG`) |
| `build <BDMV>` | Build the offline menu package (`--out DIR`, `--title NAME`, `--player-profile FILE`, `--codec hevc\|h264`, `--crf N`, `--preset NAME`, `--hdr tonemap\|preserve`, `--overwrite`, `--strict`) |
| `validate <menu dir> --offline` | Validate a menu package and update the audit report (`--format json`, `--strict`) |

`convert` is an alias of `build`. `bdmv2web --help` lists every command and `bdmv2web <command> --help` lists the options of one command.

The exit code is 0 on success and 1 on failure; with `--strict`, a partially completed result exits with 2. Option lists, output files, error codes, and the `--player-profile` schema are documented in the [development guide](https://github.com/tautcony/bdmv2web/blob/master/docs/guides/development.md).

## Contributing

Questions, bug reports, and feature requests go to [GitHub Issues](https://github.com/tautcony/bdmv2web/issues). Pull requests against `master` are accepted.

## License

[GPL-3.0-only](https://github.com/tautcony/bdmv2web/blob/master/LICENSE). Copyright (C) 2026 TautCony.

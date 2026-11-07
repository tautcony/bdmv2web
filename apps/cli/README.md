# bdmv2web

Turn a Blu-ray BDMV directory into an offline browser menu, while keeping the original M2TS video playable through the system player.

This is the published CLI package. Full documentation: <https://github.com/tautcony/bdmv2web>.

## Install

```sh
npm install -g bdmv2web
bdmv2web --version
```

Requires Node.js `>=22`. `ffmpeg` and `ffprobe` must be callable from `PATH` for media work: `ffmpeg` needs `libx265`, `libx264`, and `aac`, and HDR tone mapping additionally needs `zscale` (libzimg) or `libplacebo`.

## Quick start

```sh
bdmv2web build /path/to/BDMV --out ./BDMV-menu
```

Open `BDMV-menu/index.html` in a browser. Keep the whole output directory when copying or moving the menu.

```sh
bdmv2web validate ./BDMV-menu --offline
```

## Commands

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

The exit code is 0 on success and 1 on failure; with `--strict`, a partially completed result exits with 2.

## License

[GNU GPL v3](https://github.com/tautcony/bdmv2web/blob/master/LICENSE).

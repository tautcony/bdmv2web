# Performance fixture inputs

[`manifest.json`](manifest.json) is the fixture registry: nine `perf.*` inputs for component measurements. Each `input.path` is relative to this directory and each `source.path` is relative to its disc's `BDMV` directory. The set holds selected primary metadata, one complete filtered IGS packet stream, one prepared MNU payload, and one complete PGS SUP. No raw M2TS input is part of the set.

## Prepared inputs

| Fixture ID | Measured input | Operation | Verified output | Disc | BDMV-relative source path |
| --- | --- | --- | --- | --- | --- |
| `bdmv-index-small-v1` | `index/For.All.Mankind_index.bdmv` | Index parse | 3 entries, AppInfo present | `For.All.Mankind.1989.BluRay.REMUX.1080p.AVC.DTS-HD.MA5.1-HDS` | `index.bdmv` |
| `movieobject-heavy-tamako-v1` | `movie-object/TAMAKO_MovieObject.bdmv` | MovieObject parse | 17 objects, 4,969 instructions | `TAMAKO LOVE STORY BD` | `MovieObject.bdmv` |
| `playlist-heavy-tamako-00003-v1` | `playlist/TAMAKO_00003.mpls` | Playlist parse | 999 PlayItems, 999 marks, 1 subpath | `TAMAKO LOVE STORY BD` | `PLAYLIST/00003.mpls` |
| `clipinfo-cpi-heavy-battle-royale-v1` | `clip-info/Battle.Royale_00004.clpi` | ClipInfo/CPI parse | 1 ATC, 1 program, 7 streams, 15,322 CPI entries | `Battle.Royale.2000.Director's.Cut.2160p.UHD.Blu-ray.HEVC.DTS-HD.MA.5.1-DiY@HDHome` | `CLIPINF/00004.clpi` |
| `graph-heavy-tamako-v1` | 44 typed-file mappings in `manifest.json` | Graph build | 1,216 nodes, 8,110 edges | `TAMAKO LOVE STORY BD` | `index.bdmv`, `MovieObject.bdmv`, 26 playlist files, 16 CLPI files listed in `manifest.json` |
| `menu-battle-royale-igs-v1` | `mnu/Battle.Royale_00002_pid-1400.mnu` | IGS scene parse and asset render | 1 scene, 21 pages, 215 objects, 21 palettes; 215 rendered assets | `Battle.Royale.2000.Director's.Cut.2160p.UHD.Blu-ray.HEVC.DTS-HD.MA.5.1-DiY@HDHome` | `STREAM/00002.m2ts`, clip `00002`, PID `0x1400` |
| `media-baja-pgs-jpn-v1` | `sup/Baja.Studio_jpn.sup` | PGS parse and selected display-set composition | 508 display sets, 254 bitmaps, 14,019,858 decoded pixels; display set 83 renders to a visible 1920×1080 PNG | Local SUP file | `sup/Baja.Studio_jpn.sup` |

`menu-battle-royale-igs-v1` supplies two inputs: the filtered packet stream `ig-packets/Battle.Royale_00002_pid-1400.bin` and the prepared payload `mnu/Battle.Royale_00002_pid-1400.mnu`.

## Validation contract

- `manifest.json` records fixture IDs, versions, parameters, input paths, source paths, and measured output counts.
- Increase a fixture version when its bytes or defining parameters change.
- Component cases time one named parse, graph, scene, asset, or display-set operation. Prepared inputs and graph materialization run outside the timed graph operation.
- The graph fixture maps 44 files to canonical `BDMV/` virtual paths and records each `sourcePath` relative to the Tamako `BDMV` root. The runner copies them into a temporary BDMV tree.
- CLI scenarios run inspect, extract, and render on prepared supported inputs. Package assembly consumes a prepared scene and PNG assets.
- Fixture validation checks file existence and parser or renderer output counts.

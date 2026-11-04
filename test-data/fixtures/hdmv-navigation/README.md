# HDMV navigation fixtures

`disc-data/{tamako,baja}/BDMV` contains each case's primary index, MovieObject, PLAYLIST, CLIPINF, and filtered packet fixture in `STREAM/00005.m2ts_ig-packets.bin`. The packet files retain complete 192-byte PID 0, PMT (0x0100), and IGS (0x1400) packets from relative source `BDMV/STREAM/00005.m2ts`. Adjacent `.offset-runs.json` files map fixture packet bytes to source packet bytes. Runtime and parser tests read metadata and packets from the same BDMV root; the runtime tests pass packets to `extractIgsFromChunks`. External play requests report missing streams.

Use `node scripts/extract-m2ts-pid-packets.mjs --source FILE --output FILE --source-label RELATIVE_PATH --pids PID[,PID...]` to generate a packet fixture and its offset sidecar.

# HDMV navigation fixtures

The `tamako`, `baja`, `kyoani-ova`, `battle-royale-uhd`, and `bang-dream-mygo-vol1` cases contain filtered IGS packet fixtures for the clips exercised by `packages/igs/test/hdmv-navigation-packet-fixtures.test.ts`. Each `STREAM/xxxxx.m2ts_ig-packets.bin` retains complete 192-byte PID 0, PMT (0x0100), and IGS (0x1400) packets from relative source `BDMV/STREAM/xxxxx.m2ts`. Adjacent `.offset-runs.json` files map fixture packet bytes to source packet bytes. The source M2TS files are not included. Tests pass these packet fixtures directly to `extractIgsFromChunks`.

Use `node scripts/extract-m2ts-pid-packets.mjs --source FILE --output FILE --source-label RELATIVE_PATH --pids PID[,PID...]` to generate a packet fixture and its offset sidecar.

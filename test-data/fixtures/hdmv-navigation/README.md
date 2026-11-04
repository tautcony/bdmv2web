# HDMV navigation fixtures

`metadata-only/{tamako,baja}/BDMV` contains primary index, MovieObject, PLAYLIST, and CLIPINF data. `transport/{tamako,baja}` contains complete 192-byte PID 0, PMT (0x0100), and IGS (0x1400) packets from relative source `BDMV/STREAM/00005.m2ts`; each `offset-runs.json` maps fixture packet bytes to source packet bytes. Runtime tests parse the metadata and pass the packet fixtures to `extractIgsFromChunks`. External play requests report missing streams.

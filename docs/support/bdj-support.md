# BD-J Local Java Runtime

## Package and launch

`bdmv2web build <BDMV-or-parent>` packages the Java host, BDJO application JARs, authored files under `BDMV/JAR`, and Java launch/session data. The package stores launch data at `runtime/bdj/session.json`, the host at `runtime/bdj/bdj-host-api.jar`, and disc files under `bdj/BDMV/JAR/`.

Workspace builds compile the Java host with `javac` and `jar` and place it directly in the generated package. The published CLI includes its compiled host for package generation.

Use Java 21 or a compatible Java runtime with `java.desktop`:

```sh
bdmv2web serve <package-directory> [--port 4173] [--java <executable>]
```

The service binds to `127.0.0.1`, prints a local URL such as `http://127.0.0.1:4173/`, and starts Java when the menu page requests its BD-J session. `--java` selects the Java executable. The page reconnects to a live Java process after refresh. The service retains Java heap and threads only while that process remains alive. A process restart does not restore its heap.

Opening a BD-J package with `file://` displays the service launch command and Java requirement. Static HDMV/IGS packages continue to open directly from `file://`.

## Java process access

The Java host receives the package BDMV/JAR directory as its resource root. The Java process runs with the permissions of the account that starts `bdmv2web`. It can access files and network resources allowed to that account. The service does not enforce a Java file or network sandbox.

## Menu and feature media

The browser presents declared BD-J resources through local package URLs. Build exports accessible menu PlayItem video and audio into the output directory. Equivalent media references share one encoded asset, and `build --overwrite` reuses media assets whose source plan and encoding settings match. `serve` reads the package manifest and serves those assets without runtime transcoding. Java receives resource `pending` when the browser begins the operation, then receives `started`, `ended`, `error`, `blocked`, or `stopped` only from observed browser media events. A blocked operation remains available for user-gesture recovery while its player remains active.

Feature playback uses the `--player` adapter selected for the `serve` process:

```sh
bdmv2web serve <package-directory> --player system
bdmv2web serve <package-directory> --player mpv --player-executable <path-to-mpv>
```

The system adapter opens only explicitly whole-file targets. The mpv adapter accepts bounded multi-item playlists. A successful process launch records `requested`; it does not report playback telemetry. Java player state remains `Prefetched` until the browser reports an observed media event. A bounded playlist can therefore leave an authored BD-J menu waiting for media progress.

## Implemented service operations

BDJO application descriptors initialize PRESENT and AUTOSTART applications. Only AUTOSTART applications start automatically. An AUTOSTART Xlet starts a PRESENT menu application through its application proxy when the authored application flow requires it.

| Operation | Current behavior |
|---|---|
| `discId` | Returns the packaged 32-hex-character disc namespace read from the source `CERTIFICATE/id.bdmv` or backup. Build accepts `--disc-id <32hex>` when certificate metadata is unavailable; serve accepts the same option to override the packaged value. Missing identity metadata keeps the zero value and prints a warning during build. |
| `readGPR`, `writeGPR` | Reads or writes the shared HDMV VM general purpose register file. |
| `readPSR`, `writePSR` | Reads or updates a writable shared HDMV VM player register. |
| Java `selectTitle` | Resolves the title through INDEX and preserves shared registers. A different title number restarts title-bound Xlets; the same title number keeps the current instance. Selecting a `Service` forces a title-bound restart. Disc-bound menu Xlets retain their instance. |
| User title/menu operation | Enforces the active BDJO menu-call and title-search masks before routing. |
| Keyboard input | Forwards Java AWT `KEY_PRESSED` and `KEY_RELEASED` events, including blur releases. |
| Pointer input | Forwards logical menu coordinates to the Java scene. |
| Frames and traces | Streams PNG frames and Java diagnostics over the local event channel. |
| Menu media observations | Reports browser-presented state, playlist-clock position, PlayItem changes, and reached MPLS marks to Java player listeners. BD-J playlist items follow their authored order and end when their bounded media finishes; Xlet lifecycle selects the next state. |
| Missing BD-J menu media | Shows a warning with BDJO, title, playlist, PlayItem and source fields, then immediately skips the missing PlayItem. A missing-only playlist sends one source-bearing completion event so its Xlet can continue. |
| Shutdown | Calls Xlet destruction and closes the Java process when the service stops. |

The Java host uses PRESENT/AUTOSTART descriptors, Java TV/DVB/HAVi/JMF/Blu-ray API implementations, AWT offscreen drawing, and in-process IXC. An API method outside the implemented host behavior returns an unsupported error with a Java call trace.

## Verification record

On 2026-11-11, OpenJDK 21 loaded the Spider-Man `StandardMenuXlet` and `TitleBoundXlet` from a generated package of the complete disc directory. Both Xlets completed initialization and start lifecycle calls. The Java process emitted five 1920×1080 PNG frames. The raw frame replayed over SSE decoded to 1920×1080 with zero non-transparent pixels and an empty content bounding box. Playwright delivered ArrowRight press and release input requests to the service, then reconnected to the live JVM after page refresh without additional Java lifecycle traces. The service replayed the latest source-bearing handoff to the reconnected page.

The Java player requested playlist `00100` from `PLAYLIST/00100.mpls` at source offset 70. Its complete target is clip `00100`, from 1,048,560 through 2,347,356 90 kHz ticks (14.432 seconds). The default system opener reported that bounded playback requires mpv. The source disc also resolves playlist `00095` to clip `00098` once and clip `00099` repeated 100 times, with each item spanning 1,048,560 through 6,292,548 90 kHz ticks (58.27 seconds). `ffprobe` read the full source streams and identified H.264 video with AC-3 audio in clip `00100`, and H.264 video with Blu-ray PCM audio in clips `00098` and `00099`. The packet-window extraction was not used as full-feature playback evidence.

Historical fresh session `4200` used the authored disc ID as test input. Playlist `00100` played as a finite item and ended naturally. Playlist `00355` played source `STREAM/00356.m2ts` and ended from browser media observation. At that time, the missing second trailer item `00356/00357` advanced through a timed blank interval. That observation predates immediate-skip behavior and does not verify the current skip path. The authored Xlet then selected title 0 with restart enabled and entered BDJO `00001`, title 0. Player `menu-media00095` contained 101 PlayItems. The resulting 1920×1080 canvas displayed “Play Movie”, “Languages”, “Scene Selections” and “Special Features”; 133,416 pixels were opaque. The captured screenshot is `/tmp/bdj-final-menu.png`. Java diagnostics were empty, and left/right input reached an `HScene` with one key listener. Other menu actions were not exercised. No independent reference image comparison was run.

The Java host tests verify component pixel drawing, AWT/DVB press and release input, pointer delivery, IXC lookup, player observation states, disc-bound reuse, title-bound lifecycle and pause/resume. Cross-platform launches remain unverified.

The Java process may launch an external system player when a supported adapter is configured. A launch request records `requested`; it does not confirm feature playback, completion, audio selection, or subtitle selection.

# Tasks

## 1. BDJO data and authored menu inventory

- [x] 1.1 Preserve BDJO application descriptors, masks, accessible playlists, JAR paths, parameters and source locations in package data; verify the projected fields in the existing implementation.
- [x] 1.2 Preserve sample-independent resolution of application JARs and authored resources; verify package collection uses declared BDMV paths.
- [x] 1.3 Preserve the Spider-Man static menu/action inventory in design.md and distinguish static inventory from runtime evidence.

## 2. Native Java execution and host lifecycle

- [ ] 2.1 Launch packaged host/application JARs with a configurable native Java executable, portable classpath and package-backed VFS root; verify Java startup and missing-runtime diagnostics in integration tests.
- [ ] 2.2 Separate Java IPC reading from Xlet callbacks, reserve framed host protocol output, and clean up the process on service shutdown; verify a callback issuing synchronous RPC and worker exit.
- [ ] 2.3 Complete PRESENT/AUTOSTART, pause/resume/destroy, application context and disc/title-bound lifecycle; verify synthetic Xlet lifecycle and local IXC interactions.
- [ ] 2.4 Provide reached Java TV/DVB/Blu-ray/HAVi/JMF API behavior and explicit source-bearing unsupported errors; verify representative API calls and document the current file/network capability boundary.
- [ ] 2.5 Include application ID, BDJO, JAR, class/method, available execution location and correlated action information in diagnostics; verify actual emitted trace fields.
- [ ] 2.6 Update Java host build/provisioning documentation and verify the documented host compilation command.

## 3. Local service and authoritative disc session

- [ ] 3.1 Extract DOM-free BD-J disc host operations and title routing, with a single shared GPR/PSR and HdmvVm state in the service; verify Java-to-HDMV and HDMV-to-Java routing and GPR1000 preservation.
- [ ] 3.2 Add same-origin local session control and streaming events, reconnect to a live session, and clean up pending calls on worker failure; verify API integration and page reconnect state.
- [ ] 3.3 Apply playlist access and true-valued user title-search/menu-call masks, preserve authored Xlet navigation and action generations/continuations; verify authored requests, masked user requests and stale responses.
- [ ] 3.4 Preserve complete existing checkpoint export/restore semantics across session extraction; verify an existing full checkpoint round trip and document live-JVM reconnection scope.
- [ ] 3.5 Document local service launch, --java configuration and explicit offline runtime requirements; verify CLI help and launch diagnostics.

## 4. Browser graphics, input and menu media

- [ ] 4.1 Replace the browser JVM launcher with a local session client and display sequenced Java PNG frames with authored dimensions, alpha and active-generation ordering; verify rendering with a synthetic Java Xlet and browser evidence.
- [ ] 4.2 Forward keyboard press/release/repeat, blur releases and pointer coordinates through the content rectangle; verify logical coordinates, letterboxing and Java event delivery.
- [ ] 4.3 Render authored images/fonts/text and repaint/timer updates in native Java; verify synthetic pixel output and execute the available Spider-Man JAR to record reached behavior.
- [ ] 4.4 Present declared package menu backgrounds/sounds in browser media elements and return observed correlated events with user-gesture recovery; verify started/ended/error/blocked paths.
- [ ] 4.5 Render service-owned HDMV menu state and forward HDMV input in BD-J sessions; verify mixed navigation and keep static HDMV/IGS file:// coverage passing.
- [ ] 4.6 Update current runtime-web and menu support docs with implemented and observed graphics/input/media scope; verify registered relative documentation links.

## 5. System player handoff

- [ ] 5.1 Add portable local player launching with explicit adapter capabilities and structured executable arguments; verify Windows/macOS/Linux launch argument construction.
- [ ] 5.2 Pass full playlist/remaining PlayItems, in/out boundaries and start position to capable adapters, and return source-bearing unavailable for unsupported targets; verify multi-item and bounded-position behavior.
- [ ] 5.3 Keep requested handoff separate from JMF/HDMV actual playback state and report unsupported feature controls explicitly; verify requested does not produce inferred start/end/error events and actual menu events still work.
- [ ] 5.4 Update playback capability and generated package instructions; verify declared launch-only limitations beside the affected workflow.

## 6. Package launch and audit

- [ ] 6.1 Package native host JAR, application JARs, authored resources and service-readable session data with local-jvm launch metadata; verify a generated BD-J package.
- [ ] 6.2 Remove browser JVM runtime asset loading and the --jvm-runtime-dir build option, update package audit to the local-service contract, and verify declared paths/file existence without fingerprints or file-size gates.
- [ ] 6.3 Update HTML/file:// guidance, CLI command docs, manifest/readme/support/wiki references and documentation registration; verify generated instructions and documentation links.

## 7. Integration evidence

- [ ] 7.1 Run targeted native Java/service/browser integration plus workspace build/typecheck/lint and affected tests; record exact commands and outcomes.
- [ ] 7.2 Execute available Spider-Man Xlets through the generated package, record first frame, input, title/IXC and Gallery/Trivia reached paths, and compare graphics/navigation with independent reference evidence; keep unverified paths explicit.
- [ ] 7.3 Record platform-specific launch results and offline package/browser behavior; keep unexecuted platform and CI checks explicitly unverified.

## Evidence status

### Implemented

- BD-J playlist media follows finite authored PlayItem intervals. Missing menu sources produce a warning with available BDJO/title/playlist/PlayItem/source context and skip immediately. Consecutive missing items are processed in order. A missing-only playlist sends one source-bearing completion event; it sends no started, presented, position or mark observations.
- Build reads the 32-hex BDID from `CERTIFICATE/id.bdmv` or its backup. Build and serve accept `--disc-id <32hex>` overrides. Unknown source identity retains the zero value and build prints a warning.
- PRESENT/AUTOSTART and title-bound lifecycle behavior, Java playback observation callbacks, and source-to-playlist mark mapping are implemented.

### Verified

- `corepack pnpm --filter @bdmv2web/media-export build`, `corepack pnpm --filter @bdmv2web/runtime-web build`, `corepack pnpm --filter bdmv2web typecheck`, and `corepack pnpm --filter bdmv2web build` passed.
- `corepack pnpm --filter bdmv2web exec vitest run src/shared/disc-id.test.ts src/commands/build.test.ts` passed (8 tests). Runtime media and Java player regression results for immediate skip are recorded below after the current run.
- Root ran `tests/e2e/serve-bdj.test.ts` outside the restricted listener environment; 9/9 passed. Targeted ESLint and `git diff --check` passed on the final changes.
- Historical fresh real-disc session `4200` used the authored disc ID as test input. It verified playlist `00100`, video source `STREAM/00356.m2ts`, and the later menu state. At that time, missing source `00356/00357` used timed blank playback. That observation does not verify immediate skip behavior. The screenshot `/tmp/bdj-final-menu.png` showed “Play Movie”, “Languages”, “Scene Selections” and “Special Features” on a 1920×1080 canvas with 133,416 opaque pixels. Diagnostics were empty. Left/right input reached an `HScene` with one key listener.
- No independent reference image comparison was run. Other menu actions, cross-platform launches and CI remain unverified.

### Pending

- Root to verify the current immediate-skip behavior with a quick real-disc missing-item run. The historical timed-blank run does not cover it.
- Verify remaining authored menu actions, independent visual comparison, cross-platform launches and CI behavior.
- Complete the remaining broad runtime criteria listed in sections 1–7. The real-disc menu presentation evidence does not complete those broader criteria.

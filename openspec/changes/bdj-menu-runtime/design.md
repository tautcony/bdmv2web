# Design

## Context

The runtime executes disc-authored Xlets and HDMV navigation. The generated BD-J package runs through a local bdmv2web service and a conventional Java process. Java owns Xlet objects and AWT/HAVi drawing. The browser owns presentation of menu graphics, backgrounds, sounds, and input capture. A system player owns feature decoding and observed feature playback state.

Existing Java host code provides a main entrypoint, stdin/stdout RPC, application management, and PNG scene output. Existing browser.ts contains the disc router, register host calls, menu media operations, and external handoff. These operations are separated into a platform-neutral disc session and browser presentation services. Node-specific process, HTTP, filesystem, and player launching code stays in the CLI.

## Spider-Man fixture contract

| INDEX entry | Target | Runtime role |
|---|---|---|
| First Play | BDJO `00001` | Starts the BD-J menu application path |
| Top Menu | BDJO `00001` | Returns to the BD-J menu application |
| Title 1 | BDJO `00000` | Starts title-bound Xlet state for title 1 |
| Title 2 | BDJO `00001` | Starts title-bound Xlet state for title 2 |
| Title 3 | BDJO `00000` | Starts title-bound Xlet state for title 3 |
| Titles 4–20 | HDMV MovieObjects | Continue through the HDMV backend |

BDJO `00000` and `00001` declare the same `StandardMenuXlet` (PRESENT, disc-bound) and `TitleBoundXlet` (AUTOSTART, disc-and-title-bound), JAR base path `00000`, organization ID `0x7fff7669`, and profiles 1.1.0/1.1.1/2.1.0. `00001` masks user menu-call; both records mask user title-search and grant access to all playlists. Xlet-authored title selection uses the application navigation path. `TitleBoundXlet` reads PSR4, ensures the menu Xlet is active, and sends the title-start/title-stop event through the local IXC Messenger.

The authored resource directory contains `projectsettings.xml`, `bluray_project.bin`, `resources_eng.xml`, `resources.xml`, four composite atlases, a loader image, fonts, timer tables, and sound data. The resource XML declares five composites, 441 images, three fonts, and two sounds. `projectsettings.xml` enables multi-title menus, BDTrack, met playlists, and the post-feature Play All flow. It sets Gallery to title 13 and Trivia to title 14. The file sets branching, double-feature, 3D, and 4K-card modes to zero. The authored language resource present in this fixture is English.

Static strings in `bluray_project.bin` identify the Main Menu Splash, Main Menu, menu trailers, forced trailers, feature playback, Play All variants, and main-feature playlist. `StandardMenuXlet` calls the Gallery/Trivia helper with 13/14; the helper writes GPR1000 and selects title 10. INDEX title 10 (`title:9`) selects HDMV MovieObject 2; instructions 2106/2107 enter PC 13/14. INDEX titles 13 and 14 point to MovieObject 0 and are not used by this helper.

The application contains audio, subtitle, chapter, gallery, trivia, resume, bookmark, and playlist control paths. `ENABLE_BDTRACK=1`, `HAS_MET_PLAYLISTS=1`, and five named feature audio streams require audio selection to update the Xlet's feature playlist before playback. JMF and Blu-ray media controls expose audio/subtitle changes and playback events. The JAR also contains network and BD-Live references; the local runtime reports those operations unavailable.

The JAR inventory contains 626 class files at class-file version 47.0. Constant-pool references include Java SE I/O, collections, AWT, Java TV Xlet/selection, JMF Player/Controller, DVB application/events/IXC, HAVi scene/input, and Blu-ray RegisterAccess, BDLocator, DiscManager, TitleContext, playlist and media controls. The browser execution inventory remains trace-driven: each later menu path must record the Java class/method and host calls reached while the actual Xlet runs. Static strings alone do not establish that a menu path executes.

## Goals / Non-Goals

**Goals:**

- Execute actual BDJO-selected JAR bytecode in a local JVM with java.desktop.
- Maintain one authoritative disc session for BD-J/HDMV titles, shared registers, and correlated actions.
- Present Java-rendered menu graphics and authored browser-playable background/sound resources through a local API.
- Provide local launch requirements and portable Java/player invocation.
- Verify synthetic lifecycle, drawing, input, state routing, and handoff behavior; record reached real-disc paths individually.

**Non-Goals:**

- Feature decoding or an inferred system-player clock in the menu runtime.
- BD-Live services, arbitrary-disc BD-J conformance, or translated menu behavior.
- Process-restart restoration of Java heap/thread state through a reduced register/image snapshot.

## Decisions

### Local service and Java worker

Extend bdmv2web serve. Serve package files and session endpoints on 127.0.0.1. Start Java lazily for BD-J execution using spawn with argument arrays, the platform classpath separator, an explicit working directory, and an absolute package-backed bluray.vfs.root. Accept --java <executable>; document required Java modules and tested versions. Build requires the host JAR and disc resources. Java provisioning is a launch concern.

Java starts from the packaged host JAR and BDJO application descriptors. Keep application class/resource resolution within declared package inputs. Use ordinary file/resource APIs for packaged BDMV content. Define file/network capabilities explicitly; a readonly system property alone does not implement access isolation. Bind local APIs to the served origin and package session. Do not expose an arbitrary executable/path RPC to webpages.

### Session and transport

The service owns one live disc session per served package. The session holds INDEX entries, HdmvVm and its complete state, shared GPR/PSR, active title/BDJO, action generation, media requests and handoff records. Java keeps Xlet heap, threads, IXC objects and scene state. Reconnect attaches the page to the existing session and current graphics. Stopping serve terminates the worker and releases pending calls.

Use same-origin HTTP control endpoints and a streaming event channel. Prefer WebSocket where a maintained server implementation fits workspace dependencies; HTTP POST plus SSE is an equivalent initial transport with the same session ordering and event contract. Control messages carry sessionId, requestId/responseTo, generation, and source where applicable. Frame events carry a sequence and logical size. The browser ignores frames from an inactive generation and applies the latest valid frame. Transport is an implementation detail of the local session contract.

Java/service IPC initially reuses BDMV_RPC, BDMV_RES, BDMV_EVENT, BDMV_TRACE and BDMV_FRAME. Reserve protocol output independently of arbitrary Xlet stdout. Keep stderr and unframed application output diagnostic. A dedicated reader always accepts RPC responses. Lifecycle/input/title callbacks run on an event executor or AWT EventQueue; they do not execute inline on the reader thread. Preserve ordered register writes and title requests. Shutdown explicitly destroys Xlets, closes IPC, and terminates remaining worker threads.

### Shared navigation

Extract host operations and title resolution from browser.ts into a DOM-free TypeScript disc session. Reuse HdmvVm for HDMV. Java RegisterAccess resolves against the session register file. A title switch preserves GPR, updates PSR4, uses INDEX entry kinds for title 0 and 65535, and preserves action generation/continuations. Apply BDJO playlist access to application media requests. A true menuCallMask/titleSearchMask blocks the corresponding user operation. Xlet TitleContext requests and initial bootstrap use the application navigation path. The pinned libbluray native selectTitleN calls bdpriv_play_title_internal; public bd_play_title/bd_menu_call apply user-operation masks.

For BD-J packages the service runs the session; the browser forwards HDMV input and renders resulting menu updates. Static HDMV-only packages retain their in-page execution and file:// launch. Keep complete existing checkpoint export/restore behavior wherever the session is extracted. Reconnection to a live JVM is distinct from durable BD-J process-restoration support.

### Graphics, input, and menu media

Render HAVi/AWT in Java using BufferedImage/Graphics2D at authored logical size. Start with PNG frames, preserve alpha, clip and scene ordering, and redraw from Java repaint/timer activity. Measure animation and input-to-frame behavior. Dirty regions and binary encoding follow demonstrated need.

Browser canvas displays these frames over the menu background. Browser input maps through the displayed content rectangle, including letterboxing, to Java logical coordinates. Forward press/release/repeat and clear held keys on blur. Java owns focus and menu actions. Present authored images, fonts, strings and language resources through actual Xlet calls.

Menu background/sound requests reference declared package resources. Browser media elements execute these operations and return correlated started/ended/error/blocked events from actual observations. Autoplay recovery resumes the affected operation after a user gesture. Java timers and menu lifecycle continue independently of a feature handoff.

### Feature handoff and player capability

Resolve feature requests to ExternalPlayTarget, including the first item, remainingItems, exact in/out boundaries, playlist identity, and requested position. A local player adapter declares supported target kinds, positioning, and bounded playlist playback. A configured executable is invoked with argument arrays; the system opener has a single-file capability. Support portable launch implementations for Windows, macOS, and Linux. A target requiring capabilities absent from the selected adapter yields a source-bearing unavailable result. Do not truncate a multi-item request to its first M2TS.

Successful launch dispatch returns requested. Keep this handoff status separate from JMF Controller state and HdmvVm observed playback. Java emits StartEvent/EndOfMediaEvent and updates actual stream state only from correlated observed events. A requested handoff leaves actual feature state unobserved and does not emit ControllerErrorEvent solely for that condition. Menu selections can store desired stream/chapter intent; observed stream state requires player evidence. Feature stop, seeking, subtitles and audio controls report adapter capability results.

### Package and documentation

Emit explicit local-jvm launch metadata, a service-readable session data file, host/application JARs and authored menu resources. Remove browser OpenJDK assets, the --jvm-runtime-dir build option and the OpenJDK21 browser global contract. Update generated HTML, README, compatibility output, audit rules and current docs together. BD-J file:// pages show the executable bdmv2web serve command and Java requirement. Package audit checks declared paths and file existence. Runtime operation uses the local Java service and loopback HTTP URL.

## Risks / Trade-offs

- Native Java API/class compatibility is verified with a real JAR startup and reached-path traces; missing APIs retain source-bearing diagnostics.
- Headless AWT components, fonts, image loading and focus require synthetic and actual-menu evidence. Pin the tested Java distribution/version in evidence.
- External feature state remains unobserved for launch-only adapters. Automatic post-feature Xlet paths retain that limitation beside the affected flow.
- Native disc code has host process access. Implement and document the supported local file/network capability boundary.
- PNG frame throughput is measured during menu operation; retain latest valid graphics without an unbounded frame queue.

## Migration Plan

1. Launch the actual host with native Java; verify lifecycle, graphics/input and nonblocking IPC using authored synthetic Xlets, then the available real-disc JAR.
2. Add the local service session and browser client, with reconnect and worker shutdown coverage.
3. Move shared BD-J/HDMV routing into the service session; verify register preservation and both navigation directions.
4. Wire browser menu media and portable player adapters with truthful handoff outcomes and complete-target capability checks.
5. Update package launch contracts, audits, CLI help and current docs, and run targeted integration plus workspace checks.

Rollback keeps the static HDMV/IGS execution path. Preserve existing working-tree work and full checkpoint contracts throughout migration.

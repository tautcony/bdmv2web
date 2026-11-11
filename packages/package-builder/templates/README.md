# {{TITLE}}

Menu preview. Delivery status: **{{STATUS}}**.{{#BACKGROUND_LOOP}} The detected menu playlist uses a repeated single-clip background loop with its declared primary audio tracks.{{/BACKGROUND_LOOP}}{{#BACKGROUND_SINGLE_PLAY_ITEM}} The detected menu playlist holds the final video frame after its single PlayItem; its declared primary audio tracks end with the PlayItem.{{/BACKGROUND_SINGLE_PLAY_ITEM}}{{#BACKGROUND_UNAVAILABLE}} No menu background media was exported.{{/BACKGROUND_UNAVAILABLE}}

Run `bdmv2web validate <package-directory>` to refresh `compatibility.json`, `dependency-audit.json`, and `reports/release-summary.json`.

Open `index.html` in a browser. Use the mute button at the lower right to control menu audio.

{{#BDJ_RUNTIME}}
BD-J packages run through the local Java service. Use Java 21 or a compatible runtime with `java.desktop`, then run `bdmv2web serve <package-directory> [--java <executable>]` and open the loopback URL printed by the command. The package contains the BD-J host JAR, application JARs, authored resources and session data. A `file://` page displays the local service command; it does not start Java.

The Java process can access the files and network resources available to the invoking user. BD-J file and network access is not isolated by the service.
{{/BDJ_RUNTIME}}

{{#EXTERNAL_PLAYBACK}}
{{#BDJ_EXTERNAL_PLAYBACK}}
External playback requests use `bdmv2web serve <package-directory> --player system` to open supported whole-file targets with the operating system's default player. Use `--player mpv --player-executable <path>` for bounded or multi-item playlists. The mpv adapter passes the complete playlist and source-time bounds. A process launch is reported as requested; playback state is not observed for external players.

Edit `runtime/bdmv-config.js` and reload to change the BDMV path for browser playback.
{{/BDJ_EXTERNAL_PLAYBACK}}
{{#STATIC_EXTERNAL_PLAYBACK}}
External playback uses IINA 1.4.4 or later on macOS and PotPlayer on Windows. Configure the BDMV path in `runtime/bdmv-config.js` and reload.
{{/STATIC_EXTERNAL_PLAYBACK}}
{{/EXTERNAL_PLAYBACK}}

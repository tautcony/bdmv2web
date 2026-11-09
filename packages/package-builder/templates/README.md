# {{TITLE}}

Menu preview. Delivery status: **{{STATUS}}**.{{#BACKGROUND_LOOP}} The detected menu playlist uses a repeated single-clip background loop with its declared primary audio tracks.{{/BACKGROUND_LOOP}}{{#BACKGROUND_SINGLE_PLAY_ITEM}} The detected menu playlist holds the final video frame after its single PlayItem; its declared primary audio tracks end with the PlayItem.{{/BACKGROUND_SINGLE_PLAY_ITEM}}{{#BACKGROUND_UNAVAILABLE}} No menu background media was exported.{{/BACKGROUND_UNAVAILABLE}}

Run `bdmv2web validate <package-directory> --offline` to refresh `compatibility.json`, `dependency-audit.json`, and `reports/release-summary.json`.

Open index.html in a browser while offline. Use the mute button at the lower right to control menu audio.

{{#EXTERNAL_PLAYBACK}}
External playback requests mute menu audio automatically, and the next key or click restores that automatic mute. A manual mute stays until the mute button is used again. Edit runtime/bdmv-config.js and reload to change the BDMV path. External playback uses IINA 1.4.4 or later on macOS and PotPlayer on Windows.

The menu runs First Play initialization and then enters Top Menu. IINA 1.4.4 or later receives the selected chapter position through `mpv_start`; Windows opens the selected M2TS in PotPlayer.
{{/EXTERNAL_PLAYBACK}}

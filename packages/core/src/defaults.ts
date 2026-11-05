import type { PlayerProfile } from "./index.js";

/** Shared baseline for the command-line, package builder, and HDMV VM. */
export const DEFAULT_PLAYER_PROFILE: Readonly<PlayerProfile> = Object.freeze({
  menuLanguage: "eng", audioLanguage: "eng", subtitleLanguage: "eng",
  country: "US", region: "A", outputProfile: "portable",
  videoProfiles: [], audioProfiles: [],
});

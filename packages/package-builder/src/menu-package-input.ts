import type { DiscIR, Limits, PlayerProfile, RuntimeDataV1, SerializedScene } from "@bdmv2web/core";
import type { VmOptions, VmProgram } from "@bdmv2web/hdmv";
import type { ExternalMediaTargets, MediaAssetProgress, MediaProcessRunner, MenuLoopMediaInput, MenuMediaEncoding } from "@bdmv2web/media-export";
import type { MenuLoopMediaPackage } from "@bdmv2web/runtime-web";
import type { PngPayload } from "./asset-batches.js";
import type { SoundMetadata } from "./sounds.js";
import type { MenuPackageDiagnostic, MenuPackageMetadata, MenuPackageStatus } from "./types.js";
import type { PgsTrackPackageInput, serializePgsTrack } from "./pgs-package.js";

/** The exact bytes written to `runtime/disc-data.js`. */
export type MenuRuntimeData = RuntimeDataV1<VmProgram, NonNullable<VmOptions["entries"]>[number], ExternalMediaTargets, MenuLoopMediaPackage, ReturnType<typeof serializePgsTrack>>;

export interface BdjPackageFile { path: string; sourcePath: string; bytes: Uint8Array }

export type { MenuMediaEncoding } from "@bdmv2web/media-export";

export interface MenuPackageInput {
  outputDirectory: string;
  title: string;
  ir: DiscIR;
  scene: SerializedScene | null;
  /** Extracted title popup IGS compositions, retained with their source clip/PID. */
  popupScenes?: SerializedScene[];
  /** Extracted IGS compositions keyed by their owning HDMV menu playlist number.
   * Entries are indexed by PlayItem; the compositions themselves are written
   * once into a shared table, so PlayItems that name the same clip/PID cost
   * only their index record. */
  menuScenes?: Array<{ playlistId: number; playItem?: number; igStreamNumber?: number; igStreamCount?: number; scene: SerializedScene }>;
  /** HDMV playlist numbers that carry a menu IGS stream. */
  menuPlaylistIds?: number[];
  /** Play mark to PlayItem mapping per menu playlist, so a `PLAY_PLAYLIST_MARK` request selects the right packaged scene. */
  menuPlaylistMarks?: Array<{ playlistId: number; marks: Array<{ index: number; playItemRef: number }> }>;
  preMenuPlaylistIds?: number[];
  /** Validated SUP display sets extracted from reachable playlist PGS streams. */
  pgsTracks?: PgsTrackPackageInput[];
  pgsLimits?: { maxRuntimeBytes?: number };
  /** Delivery status decided by the caller. Defaults to `partial` for library callers. */
  status?: MenuPackageStatus;
  /** Entry counts recorded for report consumers; they never decide the status. */
  entryCounts?: { declared: number; hdmv: number };
  playerProfile?: PlayerProfile;
  vmLimits?: Limits;
  vmPrograms?: VmProgram[];
  vmEntries?: VmOptions["entries"];
  externalTargets?: ExternalMediaTargets;
  bdmvPath?: string;
  vmInitialProgramId?: number;
  vmFirstPlayProgramId?: number;
  inputConfig?: { escapeMapping?: "popup" | "topMenu" | "custom" | "none" };
  graphics: PngPayload[];
  /** BD-J application JARs and authored resources mapped into the Java virtual filesystem. */
  bdjFiles?: BdjPackageFile[];
  /** Native Java startup record for the packaged BDJO applications. */
  bdjLaunch?: { discId: string; initialBdjoId: string; applications: Array<{ bdjoId: string; controlCode: number; binding: number; organizationId: number; applicationId: number; initialClass: string; basePath: string; classPath: string; parameters: string[] }>; session?: { vmPrograms: VmProgram[]; vmEntries: VmOptions["entries"]; playerProfile: PlayerProfile; vmLimits: Limits; externalTargets?: ExternalMediaTargets; bdmvPath?: string; bdjoDescriptors?: unknown[] } };
  /** Compiled BD-J host bytes copied into this package's runtime directory. */
  bdjHostApiJar?: Uint8Array;
  soundEntries?: SoundMetadata[];
  soundBytes?: Uint8Array | null;
  runtimeVersion?: string;
  diagnostics?: MenuPackageMetadata["diagnostics"];
  /** Top Menu background/audio export. */
  menuLoopMedia?: MenuLoopMediaInput;
  /** Menu media encoder settings. Defaults to HEVC / CRF 24 / veryfast / tonemap. */
  mediaEncoding?: MenuMediaEncoding;
  /** Process runner forwarded to menu-media encoding. */
  mediaProcessRunner?: MediaProcessRunner;
  /** Local media for always-on menu playlists other than Top Menu. */
  additionalMenuMedia?: MenuLoopMediaInput[];
  onMediaProgress?: (progress: MediaAssetProgress) => void;
  /** Announces each assembly phase so a caller can report progress: media export, file writes, runtime bundle, manifest. */
  onPhase?: (phase: "media" | "assets" | "bundle" | "manifest") => void;
  /** Previous package directory used as the source for media-plan-matched assets on overwrite. */
  reuseMediaFromDirectory?: string;
  pngLimits?: { maxAssetBytes?: number; maxBatchBytes?: number; maxTotalBytes?: number };
  /** Deflate level 0-9 for packaged PGS display PNGs. Defaults to the tuned canvas level. */
  pngLevel?: number | undefined;
}

/** What the caller can act on after the package is written: the diagnostics recorded in its manifest. */
export interface MenuPackageResult { diagnostics: MenuPackageDiagnostic[] }

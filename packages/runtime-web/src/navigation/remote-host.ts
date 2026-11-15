import type { ButtonCommandContext, HdmvUpdate, NavigationAction, RawCommand, VmEvent, VmSnapshot } from "@bdmv2web/hdmv";
import type { MenuButtonExecution, RuntimeVmPort } from "../menu/menu-runtime.js";

/** The three existing `sendHdmv` request bodies; each request reuses its current JSON shape. */
export type RemoteNavigationRequest =
  | { kind: "event"; event: VmEvent }
  | { kind: "context"; pageId: number; selectedButtonId: number | null }
  | { kind: "button"; commands: RawCommand[] };

/**
 * The server-owned HDMV host used by a local-jvm package. It forwards the
 * existing request JSON and stores the authoritative snapshot from
 * `hdmv-update`. The server owns VM creation and register writes.
 */
export class RemoteNavigationHost implements RuntimeVmPort {
  readonly kind = "remote" as const;
  private current: VmSnapshot | undefined;
  private active = false;

  constructor(private readonly send: (request: RemoteNavigationRequest) => void) {}

  /** Store the authoritative state; the browser applies `actions` separately. */
  applyUpdate(update: HdmvUpdate): void {
    this.current = update.snapshot;
    this.active = update.active;
  }

  get isActive(): boolean { return this.active; }
  get hasSnapshot(): boolean { return this.current !== undefined; }

  snapshot(): VmSnapshot | undefined { return this.current; }
  /** Remote actions arrive with `hdmv-update`; the local queue stays empty. */
  drainActions(): NavigationAction[] { return []; }

  handleEvent(event: VmEvent): void { this.send({ kind: "event", event }); }
  applyMenuContext(pageId: number, selectedButtonId: number | null): void { this.send({ kind: "context", pageId, selectedButtonId }); }
  /** The server records the action context when it handles the request. */
  beginMenuAction(): void {}
  recoverMenuAction(): boolean { return false; }
  executeButtonProgram(commands: RawCommand[], _context?: ButtonCommandContext): MenuButtonExecution {
    this.send({ kind: "button", commands });
    return { kind: "pending" };
  }
}

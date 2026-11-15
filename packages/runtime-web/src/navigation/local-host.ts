import type { ButtonCommandContext, ButtonProgramResult, HdmvVm, NavigationAction, RawCommand, VmEvent, VmSnapshot } from "@bdmv2web/hdmv";
import type { RuntimeVmPort } from "../menu/menu-runtime.js";

/**
 * The offline HDMV host: a thin wrapper over the packaged VM. It provides the
 * synchronous `RuntimeVmPort` for a `file://` menu and owns every VM state read.
 */
export class LocalNavigationHost implements RuntimeVmPort {
  readonly kind = "local" as const;

  constructor(private readonly vm: HdmvVm) {}

  get registers(): HdmvVm["registers"] { return this.vm.registers; }

  snapshot(): VmSnapshot { return this.vm.snapshot(); }
  drainActions(): NavigationAction[] { return this.vm.drainActions(); }
  reset(programId: number): void { this.vm.reset(programId); }
  runTurn(): VmSnapshot { return this.vm.runTurn(); }
  selectTitle(title: number): VmSnapshot { return this.vm.selectTitle(title); }
  releaseExternalPlayback(action: NavigationAction): void { this.vm.releaseExternalPlayback(action); }

  handleEvent(event: VmEvent): VmSnapshot { return this.vm.handleEvent(event); }
  applyMenuContext(pageId: number, selectedButtonId: number | null): void { this.vm.applyMenuContext(pageId, selectedButtonId); }
  beginMenuAction(): void { this.vm.beginMenuAction(); }
  recoverMenuAction(action?: NavigationAction): boolean { return this.vm.recoverMenuAction(action); }
  executeButtonProgram(commands: RawCommand[], context?: ButtonCommandContext): ButtonProgramResult { return this.vm.executeButtonProgram(commands, context); }
}

import { HdmvVm, type ButtonCommandContext, type ButtonProgramResult, type NavigationAction, type RawCommand, type VmEvent, type VmOptions, type VmProgram, type VmSnapshot } from "@bdmv2web/hdmv";

export interface HdmvSessionOptions {
  vmPrograms: VmProgram[];
  entries?: NonNullable<VmOptions["entries"]>;
  profile?: VmOptions["profile"];
  limits?: VmOptions["limits"];
}

/**
 * The local HDMV VM owned by the serve command. Every method forwards to the
 * VM; request handlers use this session as the one state/action source.
 */
export class HdmvSession {
  private readonly vm: HdmvVm;

  constructor(options: HdmvSessionOptions) {
    this.vm = new HdmvVm(options.vmPrograms, {
      ...(options.entries ? { entries: options.entries } : {}),
      ...(options.profile ? { profile: options.profile } : {}),
      ...(options.limits ? { limits: options.limits } : {}),
    });
  }

  /** Register file used by the Java host API bridge. */
  get registers(): HdmvVm["registers"] { return this.vm.registers; }

  snapshot(): VmSnapshot { return this.vm.snapshot(); }
  selectTitle(title: number): VmSnapshot { return this.vm.selectTitle(title); }
  selectBdjTitle(title: number): VmSnapshot { return this.vm.selectBdjTitle(title); }

  applyMenuContext(pageId: number, selectedButtonId: number | null): void {
    this.vm.applyMenuContext(pageId, selectedButtonId);
  }

  handleEvent(event: VmEvent): void {
    this.vm.beginMenuAction();
    this.vm.handleEvent(event);
  }

  executeButtonProgram(commands: RawCommand[], context: ButtonCommandContext = "ig_object"): ButtonProgramResult {
    this.vm.beginMenuAction();
    return this.vm.executeButtonProgram(commands, context);
  }

  drainActions(): NavigationAction[] { return this.vm.drainActions(); }
}

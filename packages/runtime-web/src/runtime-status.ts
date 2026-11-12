export interface StatusToastOptions {
  /** Keep the message until the next update. Use it whenever the user must act on it. */
  persist?: boolean;
  /** Error styling; independent of persistence so a hint can stay without turning red. */
  error?: boolean;
}
type StatusToastHost = { textContent: string | null; classList?: { add(name: string): void; remove(name: string): void; toggle(name: string, force?: boolean): unknown } };
type StatusCopyButton = { addEventListener?: (type: string, listener: () => void) => void; setAttribute?: (name: string, value: string) => void };
/** Render status updates as a translucent toast in the top-right corner. Ordinary
 * updates fade out again; persistent ones stay until the next update and accept
 * text selection, because instructions the user has to copy must not vanish.
 * `messageHost` is the element that holds the text when the toast also carries a
 * control such as its copy button. */
export function createStatusToast(host: StatusToastHost, timeoutMs = 4500, messageHost: StatusToastHost = host): (message: string, options?: StatusToastOptions) => void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return (message, options = {}) => {
    messageHost.textContent = message;
    host.classList?.add("is-visible");
    host.classList?.toggle("is-error", options.error === true);
    host.classList?.toggle("is-persistent", options.persist === true);
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
    if (options.persist) return;
    timer = setTimeout(() => { timer = undefined; host.classList?.remove("is-visible"); }, timeoutMs);
  };
}

let statusToast: ReturnType<typeof createStatusToast> | undefined;
let statusCopyButton: StatusCopyButton | undefined;
let statusMessage = "";

export function showStatus(message: string, options?: StatusToastOptions): void {
  const element = document.getElementById("runtime-status");
  if (!element) return;
  statusMessage = message;
  statusCopyButton?.setAttribute?.("data-copied", "false");
  const messageElement = document.getElementById("runtime-status-message") as StatusToastHost | null;
  statusToast ??= createStatusToast(element, undefined, messageElement ?? element);
  statusToast(message, options);
  if (!statusCopyButton) {
    const button = document.getElementById("runtime-status-copy") as StatusCopyButton | null;
    if (button) {
      statusCopyButton = button;
      attachStatusCopy(button, () => statusMessage, () => { if (statusMessage) showStatus(statusMessage); });
    }
  }
}

/** Copy affordance for the status toast. The message is put back on screen after a
 * successful copy so the text the user acted on does not disappear mid-read. */
export function attachStatusCopy(button: StatusCopyButton, message: () => string, afterCopy?: () => void): void {
  let reset: ReturnType<typeof setTimeout> | undefined;
  button.addEventListener?.("click", () => {
    const text = message();
    if (!text) return;
    void copyText(text).then((copied) => {
      if (!copied) return;
      afterCopy?.();
      button.setAttribute?.("data-copied", "true");
      if (reset !== undefined) clearTimeout(reset);
      reset = setTimeout(() => { reset = undefined; button.setAttribute?.("data-copied", "false"); }, 1600);
    });
  });
}

/** Copy text from a `file://` page: the asynchronous Clipboard API is not available
 * in every browser and context, so the selection copy stays as the fallback. */
export async function copyText(text: string): Promise<boolean> {
  const clipboard = globalThis.navigator?.clipboard;
  if (clipboard && typeof clipboard.writeText === "function") {
    try { await clipboard.writeText(text); return true; } catch { /* use the selection copy */ }
  }
  if (typeof document.createElement !== "function" || typeof document.body?.appendChild !== "function") return false;
  const area = document.createElement("textarea");
  area.value = text;
  area.setAttribute("readonly", "");
  area.style.position = "fixed";
  area.style.top = "-1000px";
  area.style.opacity = "0";
  document.body.appendChild(area);
  area.select();
  try { return document.execCommand("copy") === true; }
  catch { return false; }
  finally { if (typeof document.body.removeChild === "function") document.body.removeChild(area); }
}

export function visibleError(error: unknown): void {
  const status = document.getElementById("runtime-status"); const detail = document.getElementById("runtime-diagnostics");
  if (status) status.role = "alert";
  showStatus("Menu preview could not start.", { persist: true, error: true });
  if (detail) { detail.hidden = false; detail.textContent = error instanceof Error ? `${error.name}: ${error.message}` : String(error); }
}

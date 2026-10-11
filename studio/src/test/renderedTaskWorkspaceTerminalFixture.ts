import { vi } from "vitest";

const workspaceHost = vi.hoisted(() => ({ invoke: vi.fn(), listen: vi.fn() }));

export function workspaceViewerInvocations() {
  return workspaceHost.invoke.mock.calls;
}

vi.mock("@tauri-apps/api/core", () => ({
  invoke: workspaceHost.invoke,
  isTauri: () => true,
  Channel: class { onmessage: unknown = null; },
}));
vi.mock("@tauri-apps/api/event", () => ({ listen: workspaceHost.listen }));

// Same external canvas/input substitution as fallback transport acceptance.
// Workspace, terminal ownership, entry pool and viewer transports stay real.
vi.mock("xterm", () => ({
  Terminal: class {
    cols = 80;
    rows = 24;
    element = document.createElement("div");
    input = document.createElement("textarea");
    output = document.createElement("pre");
    constructor() {
      this.element.className = "xterm";
      this.input.className = "xterm-helper-textarea";
      this.input.setAttribute("aria-label", "Terminal input");
      this.element.append(this.input, this.output);
    }
    open(parent: HTMLElement) { parent.append(this.element); }
    write(data: string | Uint8Array) {
      this.output.textContent += typeof data === "string" ? data : new TextDecoder().decode(data);
    }
    onData(callback: (data: string) => void) {
      const listener = () => callback(this.input.value);
      this.input.addEventListener("input", listener);
      return { dispose: () => this.input.removeEventListener("input", listener) };
    }
    focus() { this.input.focus(); }
    loadAddon() {}
    attachCustomKeyEventHandler() {}
    dispose() { this.element.remove(); }
  },
}));
vi.mock("@xterm/addon-fit", () => ({ FitAddon: class { fit() {} } }));
vi.mock("@xterm/addon-web-links", () => ({ WebLinksAddon: class {} }));

export function installWorkspaceViewerTransport() {
  vi.resetAllMocks();
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  workspaceHost.listen.mockResolvedValue(() => {});
  workspaceHost.invoke.mockImplementation(async (command: string, args?: Record<string, unknown>) => {
    if (command === "viewer_attach") {
      return { viewerHandle: "session-existing", runId: args?.runId, lifecycle: "attached" };
    }
  });
}

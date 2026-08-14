import { describe, expect, it, vi } from "vitest";
import {
  formatFrontendLogValues,
  installFrontendLogBridge,
  type FrontendLogInvoke,
} from "./frontendLogBridge";

function fakeConsole(): Console {
  return {
    debug: vi.fn(),
    log: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  } as unknown as Console;
}

describe("frontend development log bridge", () => {
  it("preserves console output and mirrors a bounded structured message", () => {
    const targetConsole = fakeConsole();
    const originalWarn = targetConsole.warn;
    const invoke = vi.fn<FrontendLogInvoke>().mockResolvedValue(undefined);
    const circular: { self?: unknown } = {};
    circular.self = circular;
    const dispose = installFrontendLogBridge({
      invoke,
      targetConsole,
      targetWindow: window,
    });

    targetConsole.warn("terminal state", { agentRunId: "run-1" }, circular);

    expect(originalWarn).toHaveBeenCalledWith(
      "terminal state",
      { agentRunId: "run-1" },
      circular,
    );
    expect(invoke).toHaveBeenCalledWith("desktop_append_frontend_log", {
      level: "warn",
      message: 'terminal state {"agentRunId":"run-1"} {"self":"[Circular]"}',
    });
    dispose();
    expect(targetConsole.warn).toBe(originalWarn);
  });

  it("captures global errors and unhandled promise rejections", () => {
    const invoke = vi.fn<FrontendLogInvoke>().mockResolvedValue(undefined);
    const dispose = installFrontendLogBridge({
      invoke,
      targetConsole: fakeConsole(),
      targetWindow: window,
    });
    const failure = new Error("render failed");

    window.dispatchEvent(new ErrorEvent("error", { error: failure }));
    const rejection = new Event("unhandledrejection") as PromiseRejectionEvent;
    Object.defineProperty(rejection, "reason", { value: failure });
    window.dispatchEvent(rejection);

    expect(invoke).toHaveBeenNthCalledWith(1, "desktop_append_frontend_log", {
      level: "error",
      message: expect.stringContaining("[window.error] Error: render failed"),
    });
    expect(invoke).toHaveBeenNthCalledWith(2, "desktop_append_frontend_log", {
      level: "error",
      message: expect.stringContaining("[unhandledrejection] Error: render failed"),
    });
    dispose();
  });

  it("formats errors and oversized values safely", () => {
    expect(formatFrontendLogValues([new Error("boom")])).toContain("Error: boom");
    expect(formatFrontendLogValues(["x".repeat(20_000)])).toMatch(/ \[truncated\]$/);
  });
});

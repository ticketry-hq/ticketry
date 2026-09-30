import { fireEvent } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { subscribeNativeTerminalChords } from "../app/navigation/nativeTerminalChords";
import { studioKeymapRegistry } from "../app/navigation/keymapRegistry";
import { registerNativeTerminalKeyboardOwner } from "../runtime/nativeTerminalKeyboard";

const host = vi.hoisted(() => ({
  report: (_event: unknown) => {},
}));

vi.mock("@tauri-apps/api/core", () => ({ isTauri: () => true, invoke: vi.fn() }));
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(async (_name: string, handler: typeof host.report) => {
    host.report = handler;
    return () => {};
  }),
}));

describe("application-wide zoom", () => {
  it("[overhaul-299] sends native zoom to the same window hotkeys without moving focus or selecting a module", async () => {
    const keys: string[] = [];
    const captureZoom = (event: KeyboardEvent) => {
      if (event.metaKey) keys.push(event.key);
    };
    const input = document.createElement("textarea");
    document.body.append(input);
    input.focus();
    window.addEventListener("keydown", captureZoom);
    const stop = subscribeNativeTerminalChords();
    const release = registerNativeTerminalKeyboardOwner({ handle: "native-1", runId: "run-1" });
    await Promise.resolve();
    try {
      for (const key of ["+", "-", "0"]) {
        fireEvent.keyDown(input, { key, metaKey: true });
        expect(studioKeymapRegistry.resolve("capture", new KeyboardEvent("keydown", {
          key, metaKey: true,
        }))).toBeNull();
      }
      const webviewKeys = keys.splice(0);
      for (const chord of ["zoom-in", "zoom-out", "zoom-reset"]) {
        host.report({ payload: { handle: "native-1", runId: "run-1", chord } });
      }
      expect(keys).toEqual(webviewKeys);
      expect(document.activeElement).toBe(input);
      release();
      host.report({ payload: { handle: "native-1", runId: "run-1", chord: "zoom-in" } });
      expect(keys).toEqual(webviewKeys);
    } finally {
      release();
      stop();
      window.removeEventListener("keydown", captureZoom);
      input.remove();
    }
  });
});

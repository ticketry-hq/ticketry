import { describe, expect, it } from "vitest";

import type { GhosttyMouseEncoder } from "../features/agents/terminal/ghostty-wasm/internal/mouseEncoder";
import type { GhosttyVtTerminal } from "../features/agents/terminal/ghostty-wasm/internal/terminalCore";
import { GhosttyWheelPolicy } from "../features/agents/terminal/ghostty-wasm/internal/wheelPolicy";

describe("Ghostty WASM full-screen scrolling", () => {
  it("[overhaul-230] scrolls Codex history without sending cursor-key input to the app", () => {
    const viewerScrolls: Array<{ direction: "up" | "down"; lines: number }> = [];
    const appInput: Uint8Array[] = [];
    const core = {
      activeScreen: () => "alternate",
      handle: 1,
      viewportActive: () => true,
    } as unknown as GhosttyVtTerminal;
    const mouse = {
      tracking: () => false,
    } as unknown as GhosttyMouseEncoder;
    const policy = new GhosttyWheelPolicy({
      core,
      mouse,
      canvas: document.createElement("canvas"),
      cellHeight: () => 20,
      viewportRows: () => 24,
      sendInput: (bytes) => appInput.push(bytes),
      scrollViewer: (direction, lines) => {
        viewerScrolls.push({ direction, lines });
      },
      scheduleFrame: () => {},
    });

    policy.wheel({
      deltaY: -40,
      deltaMode: 0,
      clientX: 0,
      clientY: 0,
      shiftKey: false,
      ctrlKey: false,
      altKey: false,
      metaKey: false,
    } as WheelEvent);

    expect(viewerScrolls).toEqual([{ direction: "up", lines: 2 }]);
    expect(appInput).toEqual([]);
  });
});

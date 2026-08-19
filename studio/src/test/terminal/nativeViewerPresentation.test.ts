import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  attachNativeViewer,
  forgetNativeViewer,
  showNativeViewer,
} from "../../features/agents/terminal/internal/nativeViewerPresentation";

const invoke = vi.hoisted(() => vi.fn(async () => undefined));

vi.mock("@tauri-apps/api/core", () => ({ invoke }));

describe("native viewer presentation", () => {
  beforeEach(() => {
    invoke.mockClear();
    forgetNativeViewer("run-agent", null);
    forgetNativeViewer("run-shell", null);
  });

  it("keeps a visible agent run presented while a distinct shell run attaches and shows", async () => {
    await showNativeViewer("run-agent", "handle-agent", async () => "agent");

    await attachNativeViewer(async () => ({ handle: "handle-shell" }));
    await showNativeViewer("run-shell", "handle-shell", async () => "shell");

    expect(invoke).not.toHaveBeenCalledWith("native_terminal_hide", {
      handle: "handle-agent",
    });
  });
});

import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { GhosttyWasmTerminal } from "../features/agents/terminal/ghostty-wasm/GhosttyWasmTerminal";

const surface = vi.hoisted(() => ({
  detach: vi.fn(),
  focus: vi.fn(),
  refit: vi.fn(),
  setActive: vi.fn(),
}));
const openSurface = vi.hoisted(() => vi.fn());

vi.mock("../features/agents/terminal/ghostty-wasm/internal/surface", () => ({
  openGhosttyWasmSurface: openSurface,
}));

vi.mock("../features/agents/terminal/internal/entryPool", () => ({
  releasePooledTransport: vi.fn(),
}));

vi.mock("../features/agents/terminal/internal/terminalClientRuntime", () => ({
  terminalClientTransport: {},
}));

vi.mock("../features/agents/terminal/ghostty-wasm/internal/rendererMeasurement", () => ({
  publishRendererMeasurements: vi.fn(),
}));

vi.mock("../features/agents/terminal/internal/terminalRegistry", () => ({
  registerTerminalFocus: vi.fn(() => () => {}),
}));

describe("Ghostty WASM retained story navigation", () => {
  it("[overhaul-228] restores the live viewer without rebuilding or reattaching it", () => {
    openSurface.mockImplementation(({ host }: { host: HTMLElement }) => {
      host.append(document.createElement("canvas"));
      return surface;
    });
    const onUnavailable = vi.fn();
    const view = render(
      <GhosttyWasmTerminal
        sessionId="session-1"
        agentRunId="run-1"
        active
        onUnavailable={onUnavailable}
      />,
    );
    const host = screen.getByTestId("ghostty-wasm-host");
    const paintedSurface = host.querySelector("canvas");

    view.rerender(
      <GhosttyWasmTerminal
        sessionId="session-1"
        agentRunId="run-1"
        active={false}
        onUnavailable={onUnavailable}
      />,
    );
    view.rerender(
      <GhosttyWasmTerminal
        sessionId="session-1"
        agentRunId="run-1"
        active
        onUnavailable={onUnavailable}
      />,
    );

    expect(openSurface).toHaveBeenCalledTimes(1);
    expect(surface.setActive.mock.calls.map(([active]) => active)).toEqual([
      true,
      false,
      true,
    ]);
    expect(host.querySelector("canvas")).toBe(paintedSurface);
    expect(surface.detach).not.toHaveBeenCalled();

    view.unmount();
    expect(surface.detach).toHaveBeenCalledTimes(1);
  });
});

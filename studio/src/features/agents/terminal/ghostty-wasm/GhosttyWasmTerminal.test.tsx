import { afterEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

const doubles = vi.hoisted(() => ({
  openGhosttyWasmSurface: vi.fn(),
  releasePooledTransport: vi.fn(),
  registerTerminalFocus: vi.fn(() => () => {}),
  publishRendererMeasurements: vi.fn(),
}));

vi.mock("./internal/surface", () => ({
  openGhosttyWasmSurface: doubles.openGhosttyWasmSurface,
}));
vi.mock("../internal/entryPool", () => ({
  releasePooledTransport: doubles.releasePooledTransport,
}));
vi.mock("../internal/terminalClientRuntime", () => ({
  terminalClientTransport: {},
}));
vi.mock("../internal/terminalRegistry", () => ({
  registerTerminalFocus: doubles.registerTerminalFocus,
}));
vi.mock("./internal/rendererMeasurement", () => ({
  publishRendererMeasurements: doubles.publishRendererMeasurements,
}));

import { GhosttyWasmTerminal } from "./GhosttyWasmTerminal";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

// Stable so it never re-runs the surface effect by identity alone; the test
// below relies on `agentRunId` being the only thing that re-creates a surface.
const onUnavailable = () => {};

interface SurfaceDouble {
  opened: { active?: boolean };
  focus: ReturnType<typeof vi.fn>;
  setActive: ReturnType<typeof vi.fn>;
  detach: ReturnType<typeof vi.fn>;
  refit: ReturnType<typeof vi.fn>;
}

const surfaces: SurfaceDouble[] = [];

doubles.openGhosttyWasmSurface.mockImplementation(
  (options: { active?: boolean }) => {
    const surface: SurfaceDouble = {
      opened: { active: options.active },
      focus: vi.fn(),
      setActive: vi.fn(),
      detach: vi.fn(),
      refit: vi.fn(),
    };
    surfaces.push(surface);
    return surface;
  },
);

let container: HTMLDivElement | null = null;
let root: Root | null = null;

function render(element: React.ReactElement): void {
  if (!container) {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  }
  act(() => {
    root!.render(element);
  });
}

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  container = null;
  root = null;
  surfaces.length = 0;
  doubles.openGhosttyWasmSurface.mockClear();
});

function host(): HTMLElement {
  const element = container?.querySelector<HTMLElement>(
    '[data-testid="ghostty-wasm-host"]',
  );
  if (!element) throw new Error("host not rendered");
  return element;
}

describe("GhosttyWasmTerminal", () => {
  it("cancels the default mousedown before focusing the surface", () => {
    render(
      <GhosttyWasmTerminal
        sessionId="s1"
        agentRunId="r1"
        onUnavailable={onUnavailable}
      />,
    );
    const event = new MouseEvent("mousedown", {
      bubbles: true,
      cancelable: true,
    });
    act(() => {
      host().dispatchEvent(event);
    });
    // Otherwise the default action hands focus to the focusable workspace
    // body, and the terminal looks focused while ignoring every keystroke.
    expect(event.defaultPrevented).toBe(true);
    expect(surfaces[0]?.focus).toHaveBeenCalledTimes(1);
  });

  it("opens a re-created surface with the current active value", () => {
    render(
      <GhosttyWasmTerminal
        sessionId="s1"
        agentRunId="r1"
        active={false}
        onUnavailable={onUnavailable}
      />,
    );
    expect(surfaces).toHaveLength(1);
    expect(surfaces[0]?.opened.active).toBe(false);

    // The retained viewer is presented, then its run is re-keyed, which
    // re-runs the surface effect.
    render(
      <GhosttyWasmTerminal
        sessionId="s1"
        agentRunId="r1"
        active
        onUnavailable={onUnavailable}
      />,
    );
    render(
      <GhosttyWasmTerminal
        sessionId="s1"
        agentRunId="r2"
        active
        onUnavailable={onUnavailable}
      />,
    );

    expect(surfaces).toHaveLength(2);
    expect(surfaces[0]?.detach).toHaveBeenCalledTimes(1);
    expect(surfaces[1]?.opened.active).toBe(true);
  });
});

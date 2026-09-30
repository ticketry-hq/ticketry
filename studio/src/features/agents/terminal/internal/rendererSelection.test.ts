import { describe, expect, it } from "vitest";

import {
  BROWSER_DEFAULT_TERMINAL_RENDERER,
  DESKTOP_DEFAULT_TERMINAL_RENDERER,
  RENDERER_STORAGE_KEY,
  defaultTerminalRenderer,
  selectedTerminalRenderer,
} from "./rendererSelection";

function storage(value: string | null) {
  return { getItem: (key: string) => (key === RENDERER_STORAGE_KEY ? value : null) };
}

describe("terminal renderer gate", () => {
  it("names native the desktop default and xterm the browser default", () => {
    expect(DESKTOP_DEFAULT_TERMINAL_RENDERER).toBe("native");
    expect(BROWSER_DEFAULT_TERMINAL_RENDERER).toBe("xterm");
    expect(defaultTerminalRenderer(true)).toBe("native");
    expect(defaultTerminalRenderer(false)).toBe("xterm");
  });

  it("uses native on desktop when nothing is set", () => {
    expect(
      selectedTerminalRenderer({
        search: "",
        storage: storage(null),
        developmentBuild: true,
        desktop: true,
      }),
    ).toBe("native");
  });

  it("renders browser development with xterm when nothing is set", () => {
    expect(
      selectedTerminalRenderer({
        search: "",
        storage: storage(null),
        developmentBuild: true,
        desktop: false,
      }),
    ).toBe("xterm");
  });

  it("ignores diagnostic overrides in packaged desktop builds", () => {
    expect(
      selectedTerminalRenderer({
        search: "?terminalRenderer=xterm",
        storage: storage("xterm"),
        developmentBuild: false,
        desktop: true,
      }),
    ).toBe("native");
  });

  // CODING-1487 archived the WASM renderer, so a flag or setting left over
  // from it names nothing and the surface default stands.
  it("ignores the archived ghostty-wasm name on every surface", () => {
    for (const desktop of [true, false]) {
      for (const developmentBuild of [true, false]) {
        expect(
          selectedTerminalRenderer({
            search: "?terminalRenderer=ghostty-wasm",
            storage: storage("ghostty-wasm"),
            developmentBuild,
            desktop,
          }),
        ).toBe(desktop ? "native" : "xterm");
      }
    }
  });

  it("prefers the launch flag over the stored development setting", () => {
    expect(
      selectedTerminalRenderer({
        search: "?terminalRenderer=xterm",
        storage: storage("native"),
        developmentBuild: true,
        desktop: true,
      }),
    ).toBe("xterm");
  });

  it("falls back to the stored development setting", () => {
    expect(
      selectedTerminalRenderer({
        search: "?other=1",
        storage: storage("XTerm"),
        developmentBuild: true,
        desktop: true,
      }),
    ).toBe("xterm");
  });

  it("ignores unknown renderer names", () => {
    expect(
      selectedTerminalRenderer({
        search: "?terminalRenderer=webgl",
        storage: storage(null),
        developmentBuild: true,
        desktop: true,
      }),
    ).toBe("native");
  });

  it("survives storage that throws", () => {
    expect(
      selectedTerminalRenderer({
        search: "",
        storage: {
          getItem() {
            throw new Error("storage disabled");
          },
        },
        developmentBuild: true,
        desktop: true,
      }),
    ).toBe("native");
  });
});

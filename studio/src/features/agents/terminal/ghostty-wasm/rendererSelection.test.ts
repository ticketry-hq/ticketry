import { describe, expect, it } from "vitest";

import {
  DEFAULT_TERMINAL_RENDERER,
  RENDERER_STORAGE_KEY,
  selectedTerminalRenderer,
} from "./rendererSelection";

function storage(value: string | null) {
  return { getItem: (key: string) => (key === RENDERER_STORAGE_KEY ? value : null) };
}

describe("terminal renderer gate", () => {
  it("uses ghostty-wasm when nothing is set", () => {
    expect(
      selectedTerminalRenderer({ search: "", storage: storage(null), developmentBuild: true }),
    ).toBe("ghostty-wasm");
  });

  it("uses ghostty-wasm in packaged builds and ignores diagnostic overrides", () => {
    expect(
      selectedTerminalRenderer({
        search: "?terminalRenderer=ghostty-wasm",
        storage: storage("ghostty-wasm"),
        developmentBuild: false,
      }),
    ).toBe(DEFAULT_TERMINAL_RENDERER);
  });

  it("prefers the launch flag over the stored development setting", () => {
    expect(
      selectedTerminalRenderer({
        search: "?terminalRenderer=ghostty-wasm",
        storage: storage("xterm"),
        developmentBuild: true,
      }),
    ).toBe("ghostty-wasm");
  });

  it("falls back to the stored development setting", () => {
    expect(
      selectedTerminalRenderer({
        search: "?other=1",
        storage: storage("XTerm"),
        developmentBuild: true,
      }),
    ).toBe("xterm");
  });

  it("ignores unknown renderer names", () => {
    expect(
      selectedTerminalRenderer({
        search: "?terminalRenderer=webgl",
        storage: storage(null),
        developmentBuild: true,
      }),
    ).toBe(DEFAULT_TERMINAL_RENDERER);
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
      }),
    ).toBe(DEFAULT_TERMINAL_RENDERER);
  });
});

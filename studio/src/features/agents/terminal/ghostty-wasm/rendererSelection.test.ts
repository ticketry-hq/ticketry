import { describe, expect, it } from "vitest";

import {
  RENDERER_STORAGE_KEY,
  selectedTerminalRenderer,
} from "./rendererSelection";

function storage(value: string | null) {
  return { getItem: (key: string) => (key === RENDERER_STORAGE_KEY ? value : null) };
}

describe("terminal renderer gate", () => {
  it("uses ghostty-wasm by default in the browser", () => {
    expect(
      selectedTerminalRenderer({
        search: "",
        storage: storage(null),
        desktopApp: false,
        developmentBuild: true,
      }),
    ).toBe("ghostty-wasm");
  });

  it("uses native libghostty by default in desktop development", () => {
    expect(
      selectedTerminalRenderer({
        search: "",
        storage: storage(null),
        desktopApp: true,
        developmentBuild: true,
      }),
    ).toBe("native");
  });

  it("uses native libghostty in packaged desktop builds", () => {
    expect(
      selectedTerminalRenderer({
        search: "?terminalRenderer=ghostty-wasm",
        storage: storage("ghostty-wasm"),
        desktopApp: true,
        developmentBuild: false,
      }),
    ).toBe("native");
  });

  it("prefers the launch flag over the stored development setting", () => {
    expect(
      selectedTerminalRenderer({
        search: "?terminalRenderer=ghostty-wasm",
        storage: storage("xterm"),
        desktopApp: true,
        developmentBuild: true,
      }),
    ).toBe("ghostty-wasm");
  });

  it("falls back to the stored development setting", () => {
    expect(
      selectedTerminalRenderer({
        search: "?other=1",
        storage: storage("XTerm"),
        desktopApp: true,
        developmentBuild: true,
      }),
    ).toBe("xterm");
  });

  it("ignores unknown renderer names", () => {
    expect(
      selectedTerminalRenderer({
        search: "?terminalRenderer=webgl",
        storage: storage(null),
        desktopApp: false,
        developmentBuild: true,
      }),
    ).toBe("ghostty-wasm");
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
        desktopApp: true,
        developmentBuild: true,
      }),
    ).toBe("native");
  });
});

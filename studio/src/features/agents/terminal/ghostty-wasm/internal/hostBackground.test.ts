import { describe, expect, it } from "vitest";

import { resolveTerminalHostBackground } from "./hostBackground";

describe("Ghostty WASM host background", () => {
  it("uses the first opaque background behind a transparent host", () => {
    const pane = document.createElement("div");
    pane.style.backgroundColor = "rgb(10, 20, 30)";
    const wrapper = document.createElement("div");
    const host = document.createElement("div");
    wrapper.append(host);
    pane.append(wrapper);
    document.body.append(pane);

    expect(resolveTerminalHostBackground(host)).toEqual({
      css: "rgb(10, 20, 30)",
      rgb: [10, 20, 30],
    });

    pane.remove();
  });
});

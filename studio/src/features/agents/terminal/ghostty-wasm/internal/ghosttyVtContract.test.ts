/**
 * CODING-1304 — contract test for the pinned libghostty-vt artifact.
 *
 * The binding reads struct offsets and enum values out of the artifact's own
 * ABI manifest, so this test is what proves the names it looks up still exist
 * and still mean what the renderer assumes. It is skipped when the artifact
 * has not been prepared; run `npm run ghostty-vt:prepare` first.
 */
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";

import { GhosttyKeyEncoder } from "./keyEncoder";
import { GhosttyMouseEncoder } from "./mouseEncoder";
import { GhosttyVtTerminal } from "./terminalCore";
import { ViewportScrollAccumulator, WHEEL_DELTA_PIXEL } from "./viewportScroll";
import { buildRuntime, type GhosttyVtExports, type GhosttyVtRuntime } from "./wasmRuntime";
import { GhosttyWheelPolicy } from "./wheelPolicy";

const ARTIFACT = resolve(process.cwd(), "public/ghostty-vt/ghostty-vt.wasm");
const prepared = existsSync(ARTIFACT);

const decoder = new TextDecoder();
const encoder = new TextEncoder();

/** Read a frame's dirty rows as plain strings, trailing blanks trimmed. */
function rowText(terminal: GhosttyVtTerminal): Map<number, string> {
  const rows = new Map<number, string>();
  for (const row of terminal.frame().dirtyRows) {
    rows.set(row.y, row.cells.map((cell) => cell.text || " ").join("").trimEnd());
  }
  return rows;
}

/** Every row the viewport currently shows, top first. */
function viewportText(terminal: GhosttyVtTerminal): string[] {
  terminal.markDirty();
  const frame = terminal.frame();
  const rows = rowText(terminal);
  return Array.from({ length: frame.rows }, (_unused, y) => rows.get(y) ?? "");
}

/** A terminal holding more numbered lines than its viewport can show. */
function scrolledTerminal(runtime: GhosttyVtRuntime, rows: number): GhosttyVtTerminal {
  const terminal = new GhosttyVtTerminal(runtime, { cols: 20, rows });
  writeLines(terminal, 1, 12);
  return terminal;
}

/** Numbered lines, in the same `lineNN` form `scrolledTerminal` writes. */
function writeLines(terminal: GhosttyVtTerminal, from: number, to: number): void {
  for (let line = from; line <= to; line += 1) {
    terminal.write(encoder.encode(`line${String(line).padStart(2, "0")}\r\n`));
  }
}

/** One cell of wheel travel, in the pixels a gesture is measured in. */
const CELL_HEIGHT = 20;
const VIEWPORT_ROWS = 4;

/**
 * The real wheel policy over a real terminal. Only the DOM and transport seams
 * are stubbed, so what this drives is the whole local-scroll decision.
 */
function localWheelPolicy(terminal: GhosttyVtTerminal): GhosttyWheelPolicy {
  return new GhosttyWheelPolicy({
    core: terminal,
    // Nothing is tracking, which is what puts a gesture on the local branch.
    mouse: { tracking: () => false, encodeWheel: () => null } as unknown as GhosttyMouseEncoder,
    canvas: {
      getBoundingClientRect: () => ({ left: 0, top: 0 }) as DOMRect,
    } as HTMLCanvasElement,
    cellHeight: () => CELL_HEIGHT,
    viewportRows: () => VIEWPORT_ROWS,
    sendInput: () => {},
    scrollViewer: () => {},
    scheduleFrame: () => {},
  });
}

/**
 * A pixel-mode wheel gesture worth `cells` whole cells of `deltaY`. The sign is
 * `deltaY`'s own: negative scrolls up, back into history.
 */
function wheelCells(cells: number): WheelEvent {
  return {
    deltaY: cells * CELL_HEIGHT,
    deltaMode: WHEEL_DELTA_PIXEL,
    clientX: 0,
    clientY: 0,
    shiftKey: false,
    ctrlKey: false,
    altKey: false,
    metaKey: false,
  } as WheelEvent;
}

/** Whether Ghostty's scrollbar puts the viewport at the end of the history. */
function atLiveBottom(terminal: GhosttyVtTerminal): boolean {
  const bar = terminal.scrollbar();
  return bar.offset === bar.total - bar.len;
}

describe.skipIf(!prepared)("libghostty-vt artifact contract", () => {
  let runtime: GhosttyVtRuntime;

  beforeAll(async () => {
    const module = await WebAssembly.compile(readFileSync(ARTIFACT));
    const instance = await WebAssembly.instantiate(module, {});
    runtime = buildRuntime(instance.exports as unknown as GhosttyVtExports);
  });

  it("publishes an ABI manifest for a wasm32 target", () => {
    expect(runtime.manifest.schema).toBe(1);
    expect(runtime.manifest.abi.pointer_size).toBe(4);
    expect(runtime.manifest.abi.endian).toBe("little");
    expect(runtime.enumValue("GhosttyResult", "SUCCESS")).toBe(0);
  });

  it("parses plain output into the rows the renderer draws", () => {
    const terminal = new GhosttyVtTerminal(runtime, { cols: 20, rows: 4 });
    try {
      terminal.write(encoder.encode("hello\r\nworld"));
      const rows = rowText(terminal);
      expect(rows.get(0)).toBe("hello");
      expect(rows.get(1)).toBe("world");
    } finally {
      terminal.dispose();
    }
  });

  it("resolves SGR colours to the RGB the canvas fills with", () => {
    const terminal = new GhosttyVtTerminal(runtime, { cols: 20, rows: 2 });
    try {
      terminal.write(encoder.encode("\x1b[38;2;255;128;0mX\x1b[0mY"));
      const frame = terminal.frame();
      const row = frame.dirtyRows.find((candidate) => candidate.y === 0);
      expect(row?.cells[0]?.text).toBe("X");
      expect(row?.cells[0]?.fg).toBe("#ff8000");
      expect(row?.cells[1]?.text).toBe("Y");
      expect(row?.cells[1]?.fg).toBe(frame.foreground);
    } finally {
      terminal.dispose();
    }
  });

  it("carries bold and underline through to the cell style", () => {
    const terminal = new GhosttyVtTerminal(runtime, { cols: 20, rows: 2 });
    try {
      terminal.write(encoder.encode("\x1b[1mB\x1b[0m\x1b[4mU\x1b[0m"));
      const row = terminal.frame().dirtyRows.find((candidate) => candidate.y === 0);
      expect(row?.cells[0]).toMatchObject({ text: "B", bold: true });
      expect(row?.cells[1]).toMatchObject({ text: "U", underline: true });
    } finally {
      terminal.dispose();
    }
  });

  it("swaps foreground and background for inverse cells", () => {
    const terminal = new GhosttyVtTerminal(runtime, { cols: 20, rows: 2 });
    try {
      // Ghostty reports `inverse` as an attribute without resolving it, so a
      // cell styled with an explicit foreground must come back painted as a
      // background. Getting this wrong makes inverse text invisible.
      terminal.write(encoder.encode("\x1b[7mA\x1b[0m\x1b[7;38;2;255;0;0mB\x1b[0m"));
      const frame = terminal.frame();
      const row = frame.dirtyRows.find((candidate) => candidate.y === 0);
      expect(row?.cells[0]).toMatchObject({
        text: "A",
        fg: frame.background,
        bg: frame.foreground,
      });
      expect(row?.cells[1]).toMatchObject({ text: "B", bg: "#ff0000" });
      expect(row?.cells[1]?.fg).toBe(frame.background);
    } finally {
      terminal.dispose();
    }
  });

  it("reports the cursor position the renderer paints", () => {
    const terminal = new GhosttyVtTerminal(runtime, { cols: 20, rows: 4 });
    try {
      terminal.write(encoder.encode("abc"));
      expect(terminal.frame().cursor).toMatchObject({ x: 3, y: 0, visible: true });
    } finally {
      terminal.dispose();
    }
  });

  it("reports no damage once a frame has been consumed", () => {
    const terminal = new GhosttyVtTerminal(runtime, { cols: 20, rows: 4 });
    try {
      terminal.write(encoder.encode("first"));
      expect(terminal.frame().dirty).not.toBe("none");
      terminal.clean();
      expect(terminal.frame().dirty).toBe("none");
      terminal.write(encoder.encode("\r\nsecond"));
      expect(terminal.frame().dirty).not.toBe("none");
    } finally {
      terminal.dispose();
    }
  });

  it("can be forced back to a full repaint after a canvas resize", () => {
    const terminal = new GhosttyVtTerminal(runtime, { cols: 20, rows: 4 });
    try {
      terminal.write(encoder.encode("painted"));
      terminal.frame();
      terminal.clean();
      expect(terminal.frame().dirty).toBe("none");
      terminal.markDirty();
      const frame = terminal.frame();
      expect(frame.dirty).not.toBe("none");
      expect(frame.dirtyRows.length).toBeGreaterThan(0);
    } finally {
      terminal.dispose();
    }
  });

  it("reflows on resize", () => {
    const terminal = new GhosttyVtTerminal(runtime, { cols: 20, rows: 4 });
    try {
      terminal.write(encoder.encode("resize me"));
      terminal.resize(40, 8, 8, 17);
      const frame = terminal.frame();
      expect(frame.cols).toBe(40);
      expect(frame.rows).toBe(8);
    } finally {
      terminal.dispose();
    }
  });

  it("encodes keys through Ghostty's own encoder", () => {
    const terminal = new GhosttyVtTerminal(runtime, { cols: 20, rows: 4 });
    const keys = new GhosttyKeyEncoder(runtime);
    const encode = (event: Partial<Parameters<GhosttyKeyEncoder["encode"]>[1]>) =>
      keys.encode(terminal.handle, {
        code: "",
        key: "",
        shiftKey: false,
        ctrlKey: false,
        altKey: false,
        metaKey: false,
        repeat: false,
        isComposing: false,
        ...event,
      });
    try {
      expect(decoder.decode(encode({ code: "KeyA", key: "a" }) ?? undefined)).toBe("a");
      expect(decoder.decode(encode({ code: "Enter", key: "Enter" }) ?? undefined)).toBe("\r");
      expect(decoder.decode(encode({ code: "ArrowUp", key: "ArrowUp" }) ?? undefined)).toBe(
        "\x1b[A",
      );
      expect(
        decoder.decode(encode({ code: "KeyC", key: "c", ctrlKey: true }) ?? undefined),
      ).toBe("\x03");
      expect(encode({ code: "ShiftLeft", key: "Shift", shiftKey: true })).toBeNull();
    } finally {
      keys.dispose();
      terminal.dispose();
    }
  });

  it("reports no mouse tracking until a program turns it on", () => {
    const terminal = new GhosttyVtTerminal(runtime, { cols: 20, rows: 6 });
    const mouse = new GhosttyMouseEncoder(runtime);
    try {
      expect(mouse.tracking(terminal.handle)).toBe(false);
      // DECSET 1000 is the normal tracking mode every full-screen program
      // enables; 1006 asks for the SGR report format.
      terminal.write(encoder.encode("\u001b[?1000h\u001b[?1006h"));
      expect(mouse.tracking(terminal.handle)).toBe(true);
      terminal.write(encoder.encode("\u001b[?1000l"));
      expect(mouse.tracking(terminal.handle)).toBe(false);
    } finally {
      mouse.dispose();
      terminal.dispose();
    }
  });

  it("encodes a wheel notch as the SGR report the program expects", () => {
    const terminal = new GhosttyVtTerminal(runtime, { cols: 20, rows: 6 });
    const mouse = new GhosttyMouseEncoder(runtime);
    try {
      terminal.write(encoder.encode("\u001b[?1000h\u001b[?1006h"));
      mouse.setViewport({
        screenWidth: 200,
        screenHeight: 120,
        cellWidth: 10,
        cellHeight: 20,
      });
      const up = mouse.encodeWheel(terminal.handle, {
        direction: "up",
        x: 25,
        y: 45,
        mods: 0,
      });
      // Button 64 is wheel-up in SGR; the cell is 1-based, so pixel 25/45
      // with a 10x20 cell is column 3, row 3.
      expect(up && decoder.decode(up)).toBe("\u001b[<64;3;3M");
      const down = mouse.encodeWheel(terminal.handle, {
        direction: "down",
        x: 25,
        y: 45,
        mods: 0,
      });
      expect(down && decoder.decode(down)).toBe("\u001b[<65;3;3M");
    } finally {
      mouse.dispose();
      terminal.dispose();
    }
  });

  it("scrolls the viewport back into scrollback for a negative delta", () => {
    // This is the assertion the whole scroll policy rests on: which sign of
    // `GHOSTTY_SCROLL_VIEWPORT_DELTA` shows older content. `viewportScroll.ts`
    // documents the answer; this proves it against the pinned artifact.
    const terminal = scrolledTerminal(runtime, 4);
    try {
      const bottom = viewportText(terminal);
      expect(bottom[0]).toBe("line10");
      expect(bottom[2]).toBe("line12");

      terminal.scrollViewportDelta(-1);
      expect(viewportText(terminal)).toEqual(["line09", "line10", "line11", "line12"]);

      terminal.scrollViewportDelta(1);
      expect(viewportText(terminal)).toEqual(bottom);
    } finally {
      terminal.dispose();
    }
  });

  it("clamps a viewport delta at both ends of the history", () => {
    const terminal = scrolledTerminal(runtime, 4);
    try {
      terminal.scrollViewportDelta(-1000);
      expect(viewportText(terminal)).toEqual(["line01", "line02", "line03", "line04"]);
      terminal.scrollViewportDelta(-1000);
      expect(viewportText(terminal)[0]).toBe("line01");
      terminal.scrollViewportDelta(1000);
      expect(viewportText(terminal)[0]).toBe("line10");
      terminal.scrollViewportDelta(1000);
      expect(viewportText(terminal)[0]).toBe("line10");
    } finally {
      terminal.dispose();
    }
  });

  it("moves the scrollbar offset by exactly the rows it was scrolled", () => {
    const terminal = scrolledTerminal(runtime, 4);
    try {
      const bottom = terminal.scrollbar();
      expect(bottom.len).toBe(4);
      expect(bottom.total).toBeGreaterThan(bottom.len);
      // At the bottom the viewport sits at the end of the history, which is
      // what makes `total - len` the rows of scroll-back available.
      expect(bottom.offset).toBe(bottom.total - bottom.len);

      terminal.scrollViewportDelta(-3);
      expect(terminal.scrollbar().offset).toBe(bottom.offset - 3);

      terminal.scrollViewportToBottom();
      expect(terminal.scrollbar()).toEqual(bottom);
    } finally {
      terminal.dispose();
    }
  });

  it("reports the viewport live only while it is pinned to the bottom", () => {
    const terminal = scrolledTerminal(runtime, 4);
    try {
      expect(terminal.viewportActive()).toBe(true);
      terminal.scrollViewportDelta(-1);
      expect(terminal.viewportActive()).toBe(false);
      terminal.scrollViewportToBottom();
      expect(terminal.viewportActive()).toBe(true);
    } finally {
      terminal.dispose();
    }
  });

  it("reports which screen a program has on show", () => {
    const terminal = new GhosttyVtTerminal(runtime, { cols: 20, rows: 4 });
    try {
      expect(terminal.activeScreen()).toBe("primary");
      // DECSET 1049 is how every full-screen program takes the alternate
      // screen, which has no scrollback for the renderer to scroll.
      terminal.write(encoder.encode("\u001b[?1049h"));
      expect(terminal.activeScreen()).toBe("alternate");
      terminal.write(encoder.encode("\u001b[?1049l"));
      expect(terminal.activeScreen()).toBe("primary");
    } finally {
      terminal.dispose();
    }
  });

  it("scrolls the artifact the way the accumulator says a wheel gesture should", () => {
    const terminal = scrolledTerminal(runtime, 4);
    const position = new ViewportScrollAccumulator();
    try {
      const bar = terminal.scrollbar();
      const gesture = {
        deltaMode: WHEEL_DELTA_PIXEL,
        cellHeight: 20,
        scrollbackRows: bar.total - bar.len,
        viewportRows: 4,
      };
      // A wheel up of one and a half cells: one row of viewport move and half a
      // cell of paint offset.
      const up = position.wheel({ ...gesture, deltaY: -30 });
      expect(up).toEqual({ rows: -1, offsetPx: 10 });
      terminal.scrollViewportDelta(up.rows);
      expect(viewportText(terminal)[0]).toBe("line09");

      // Wheeling back down by the same distance returns to the live bottom with
      // an exactly zero offset, so steady-state painting is unshifted.
      const down = position.wheel({ ...gesture, deltaY: 30 });
      expect(down).toEqual({ rows: 1, offsetPx: 0 });
      terminal.scrollViewportDelta(down.rows);
      expect(position.atBottom).toBe(true);
      expect(terminal.viewportActive()).toBe(true);
      expect(viewportText(terminal)[0]).toBe("line10");
    } finally {
      terminal.dispose();
    }
  });

  it("wheels back to the live bottom after output arrived while scrolled back", () => {
    // The defect this pins: the reader scrolls back, output arrives, and every
    // route back to the live bottom is shut because the renderer's own row
    // count no longer describes where Ghostty's viewport is.
    const terminal = scrolledTerminal(runtime, VIEWPORT_ROWS);
    const policy = localWheelPolicy(terminal);
    try {
      policy.wheel(wheelCells(-3));
      expect(viewportText(terminal)[0]).toBe("line07");
      expect(terminal.viewportActive()).toBe(false);

      // Five more lines. Ghostty holds the viewport where the reader put it, so
      // the live bottom moves five rows away from it on its own.
      writeLines(terminal, 13, 17);
      const grown = terminal.scrollbar();
      expect(grown.offset).toBe(grown.total - grown.len - 8);

      // Wheeling down by the three rows the reader scrolled up covers three of
      // the eight. It must not be mistaken for arriving at the bottom.
      policy.wheel(wheelCells(3));
      const partway = terminal.scrollbar();
      expect(partway.offset).toBe(partway.total - partway.len - 5);
      expect(terminal.viewportActive()).toBe(false);

      // The remaining five reach it, and the terminal itself confirms it.
      policy.wheel(wheelCells(5));
      const bottom = terminal.scrollbar();
      expect(bottom.offset).toBe(bottom.total - bottom.len);
      expect(terminal.viewportActive()).toBe(true);
      expect(policy.offsetPx).toBe(0);
      expect(viewportText(terminal)).toEqual(["line15", "line16", "line17", ""]);

      // And output that arrives now is visible, which is the whole point.
      writeLines(terminal, 18, 18);
      expect(viewportText(terminal)).toEqual(["line16", "line17", "line18", ""]);
      expect(atLiveBottom(terminal)).toBe(true);
    } finally {
      terminal.dispose();
    }
  });

  it("snaps to the live bottom after output arrived while scrolled back", () => {
    // A keystroke is the reader's other way back, and it has to work from the
    // same desynchronised state — `snapToBottom` used to return early there.
    const terminal = scrolledTerminal(runtime, VIEWPORT_ROWS);
    const policy = localWheelPolicy(terminal);
    try {
      policy.wheel(wheelCells(-3));
      writeLines(terminal, 13, 17);
      // The gesture that used to be believed to land on the bottom.
      policy.wheel(wheelCells(3));
      expect(terminal.viewportActive()).toBe(false);

      policy.snapToBottom();
      const bar = terminal.scrollbar();
      expect(bar.offset).toBe(bar.total - bar.len);
      expect(terminal.viewportActive()).toBe(true);
      expect(policy.offsetPx).toBe(0);
      expect(viewportText(terminal)).toEqual(["line15", "line16", "line17", ""]);

      writeLines(terminal, 18, 18);
      expect(viewportText(terminal)[2]).toBe("line18");
    } finally {
      terminal.dispose();
    }
  });

  it("encodes nothing when no program is tracking the mouse", () => {
    const terminal = new GhosttyVtTerminal(runtime, { cols: 20, rows: 6 });
    const mouse = new GhosttyMouseEncoder(runtime);
    try {
      mouse.setViewport({ screenWidth: 200, screenHeight: 120, cellWidth: 10, cellHeight: 20 });
      expect(
        mouse.encodeWheel(terminal.handle, { direction: "up", x: 25, y: 45, mods: 0 }),
      ).toBeNull();
    } finally {
      mouse.dispose();
      terminal.dispose();
    }
  });
});

describe.skipIf(prepared)("libghostty-vt artifact", () => {
  it("is absent until `npm run ghostty-vt:prepare` has run", () => {
    expect(prepared).toBe(false);
  });
});

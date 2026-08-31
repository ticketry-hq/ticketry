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
import { GhosttyVtTerminal } from "./terminalCore";
import { buildRuntime, type GhosttyVtExports, type GhosttyVtRuntime } from "./wasmRuntime";

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
});

describe.skipIf(prepared)("libghostty-vt artifact", () => {
  it("is absent until `npm run ghostty-vt:prepare` has run", () => {
    expect(prepared).toBe(false);
  });
});

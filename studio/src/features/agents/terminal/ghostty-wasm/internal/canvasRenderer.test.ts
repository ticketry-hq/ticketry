/**
 * CODING-1304 — the painter's contract: it draws whole dirty rows and nothing
 * else, so a quiet terminal costs no pixels and a busy one costs only what
 * changed. Driven through a recording 2d context because jsdom has no canvas.
 */
import { describe, expect, it } from "vitest";

import { TerminalCanvasRenderer } from "./canvasRenderer";
import type { Frame, FrameCell } from "./frameTypes";

interface Call {
  op: string;
  args: unknown[];
}

function recordingCanvas() {
  const calls: Call[] = [];
  const context = {
    font: "",
    fillStyle: "",
    strokeStyle: "",
    lineWidth: 1,
    textBaseline: "",
    globalCompositeOperation: "source-over",
    setTransform: (...args: unknown[]) => calls.push({ op: "setTransform", args }),
    fillRect: (...args: unknown[]) =>
      calls.push({ op: "fillRect", args: [...args, context.fillStyle] }),
    strokeRect: (...args: unknown[]) => calls.push({ op: "strokeRect", args }),
    fillText: (...args: unknown[]) =>
      calls.push({ op: "fillText", args: [...args, context.fillStyle] }),
    measureText: () => ({ width: 8, actualBoundingBoxAscent: 10 }),
  };
  const canvas = {
    width: 0,
    height: 0,
    style: {} as CSSStyleDeclaration,
    getContext: () => context,
  } as unknown as HTMLCanvasElement;
  return { canvas, calls };
}

function cell(overrides: Partial<FrameCell> = {}): FrameCell {
  return {
    text: "a",
    fg: "#ffffff",
    bg: "#000000",
    bold: false,
    italic: false,
    underline: false,
    strikethrough: false,
    selected: false,
    ...overrides,
  };
}

function frame(overrides: Partial<Frame> = {}): Frame {
  return {
    cols: 4,
    rows: 3,
    dirty: "partial",
    background: "#000000",
    foreground: "#ffffff",
    cursor: null,
    dirtyRows: [],
    ...overrides,
  };
}

describe("terminal canvas renderer", () => {
  it("reports the grid that fits a CSS box", () => {
    const { canvas } = recordingCanvas();
    const renderer = new TerminalCanvasRenderer(canvas, { fontSize: 13, pixelRatio: 2 });
    const geometry = renderer.resizeTo(320, 340);
    expect(geometry.cols).toBe(40);
    expect(geometry.rows).toBe(Math.floor(340 / renderer.metrics.height));
    expect(canvas.width).toBe(640);
  });

  it("paints nothing for a clean frame", () => {
    const { canvas, calls } = recordingCanvas();
    const renderer = new TerminalCanvasRenderer(canvas);
    renderer.resizeTo(100, 100);
    calls.length = 0;
    renderer.paint(frame({ dirty: "none", dirtyRows: [{ y: 0, cells: [cell()] }] }));
    expect(calls).toEqual([]);
  });

  it("paints only the rows Ghostty marked dirty", () => {
    const { canvas, calls } = recordingCanvas();
    const renderer = new TerminalCanvasRenderer(canvas);
    renderer.resizeTo(100, 100);
    calls.length = 0;
    renderer.paint(
      frame({
        dirtyRows: [{ y: 2, cells: [cell({ text: "x" }), cell({ text: "y" })] }],
      }),
    );
    const texts = calls.filter((call) => call.op === "fillText");
    expect(texts.map((call) => call.args[0])).toEqual(["x", "y"]);
    const rowY = renderer.metrics.height * 2;
    expect(texts.every((call) => Number(call.args[2]) > rowY)).toBe(true);
  });

  it("fills a cell background only when it differs from the frame background", () => {
    const { canvas, calls } = recordingCanvas();
    const renderer = new TerminalCanvasRenderer(canvas);
    renderer.resizeTo(100, 100);
    calls.length = 0;
    renderer.paint(
      frame({
        dirtyRows: [
          { y: 0, cells: [cell({ bg: "#000000" }), cell({ bg: "#ff0000" })] },
        ],
      }),
    );
    const fills = calls.filter((call) => call.op === "fillRect");
    // One row clear plus exactly one differing cell background.
    expect(fills).toHaveLength(2);
    expect(fills[1].args[4]).toBe("#ff0000");
  });

  it("skips the cursor when its row was not repainted", () => {
    const { canvas, calls } = recordingCanvas();
    const renderer = new TerminalCanvasRenderer(canvas);
    renderer.resizeTo(100, 100);
    calls.length = 0;
    renderer.paint(
      frame({
        dirtyRows: [{ y: 0, cells: [cell()] }],
        cursor: { visible: true, blinking: false, x: 0, y: 2, style: "bar" },
      }),
    );
    expect(calls.filter((call) => call.op === "fillRect")).toHaveLength(1);
  });

  it("paints identically for an omitted and a zero scroll offset", () => {
    const plain = recordingCanvas();
    const zero = recordingCanvas();
    const drawn = frame({
      dirtyRows: [{ y: 1, cells: [cell({ text: "x" }), cell({ bg: "#ff0000" })] }],
      cursor: { visible: true, blinking: false, x: 1, y: 1, style: "block" },
    });
    new TerminalCanvasRenderer(plain.canvas).paint(drawn);
    new TerminalCanvasRenderer(zero.canvas).paint(drawn, 0);
    expect(zero.calls).toEqual(plain.calls);
  });

  it("shifts the grid down by a fractional scroll offset", () => {
    const { canvas, calls } = recordingCanvas();
    const renderer = new TerminalCanvasRenderer(canvas);
    renderer.resizeTo(100, 100);
    calls.length = 0;
    const offsetPx = 7;
    renderer.paint(
      frame({ dirtyRows: [{ y: 1, cells: [cell({ text: "x" })] }] }),
      offsetPx,
    );
    const fills = calls.filter((call) => call.op === "fillRect");
    // The strip the shift exposes is filled with the frame background first.
    expect(fills[0].args.slice(0, 4)).toEqual([0, 0, 100, offsetPx]);
    // Then the row lands one cell down plus the remainder.
    expect(fills[1].args[1]).toBe(renderer.metrics.height + offsetPx);
    const text = calls.find((call) => call.op === "fillText");
    expect(Number(text?.args[2])).toBe(
      renderer.metrics.height + offsetPx + renderer.metrics.baseline,
    );
  });

  it("ignores a negative or non-finite scroll offset", () => {
    const { canvas, calls } = recordingCanvas();
    const renderer = new TerminalCanvasRenderer(canvas);
    renderer.resizeTo(100, 100);
    calls.length = 0;
    renderer.paint(frame({ dirtyRows: [{ y: 0, cells: [cell()] }] }), -12);
    renderer.paint(frame({ dirtyRows: [{ y: 0, cells: [cell()] }] }), Number.NaN);
    expect(calls.filter((call) => call.op === "fillRect").map((call) => call.args[1])).toEqual([
      0, 0,
    ]);
  });

  it("paints a bar cursor on a repainted row", () => {
    const { canvas, calls } = recordingCanvas();
    const renderer = new TerminalCanvasRenderer(canvas);
    renderer.resizeTo(100, 100);
    calls.length = 0;
    renderer.paint(
      frame({
        dirtyRows: [{ y: 1, cells: [] }],
        cursor: { visible: true, blinking: false, x: 3, y: 1, style: "bar" },
      }),
    );
    const fills = calls.filter((call) => call.op === "fillRect");
    expect(fills).toHaveLength(2);
    expect(fills[1].args[0]).toBe(3 * renderer.metrics.width);
  });
});

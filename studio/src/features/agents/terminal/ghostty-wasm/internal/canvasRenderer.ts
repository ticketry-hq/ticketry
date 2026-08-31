/**
 * CODING-1304 — Canvas 2D painter for libghostty-vt frames.
 *
 * Draws whole dirty rows: Ghostty already tracks damage, so a quiet terminal
 * paints nothing and a busy one paints only the rows that changed. The canvas
 * retains the previous frame's pixels between paints, which is what makes
 * partial repaint correct without a shadow buffer.
 *
 * Deliberately free of React and of terminal state — it takes a frame and puts
 * pixels on a canvas.
 */
import type { Frame, FrameCell, FrameRow } from "./frameTypes";

export interface CellMetrics {
  width: number;
  height: number;
  baseline: number;
}

export interface CanvasRendererOptions {
  fontFamily: string;
  fontSize: number;
  /** Backing-store scale; 1 keeps the canvas in CSS pixels. */
  pixelRatio: number;
}

export const DEFAULT_CANVAS_RENDERER_OPTIONS: CanvasRendererOptions = {
  fontFamily: "JetBrains Mono, Fira Code, ui-monospace, monospace",
  fontSize: 13,
  pixelRatio: 1,
};

export class TerminalCanvasRenderer {
  private readonly context: CanvasRenderingContext2D;
  private readonly canvas: HTMLCanvasElement;
  private options: CanvasRendererOptions;
  private cell: CellMetrics;
  private lastBackground = "#000000";

  constructor(canvas: HTMLCanvasElement, options: Partial<CanvasRendererOptions> = {}) {
    const context = canvas.getContext("2d");
    if (!context) throw new Error("ghostty-wasm renderer requires a 2d canvas context");
    this.canvas = canvas;
    this.context = context;
    this.options = { ...DEFAULT_CANVAS_RENDERER_OPTIONS, ...options };
    this.cell = this.measureCell();
  }

  get metrics(): CellMetrics {
    return this.cell;
  }

  /** Re-measure after a font change and report the new cell box. */
  setOptions(options: Partial<CanvasRendererOptions>): CellMetrics {
    this.options = { ...this.options, ...options };
    this.cell = this.measureCell();
    return this.cell;
  }

  /**
   * Size the backing store for a CSS box and report the grid that fits. The
   * caller resizes the terminal to the returned geometry.
   */
  resizeTo(cssWidth: number, cssHeight: number): { cols: number; rows: number } {
    const ratio = this.options.pixelRatio;
    this.canvas.width = Math.max(1, Math.floor(cssWidth * ratio));
    this.canvas.height = Math.max(1, Math.floor(cssHeight * ratio));
    this.canvas.style.width = `${cssWidth}px`;
    this.canvas.style.height = `${cssHeight}px`;
    // Resizing clears the backing store, so the next frame must repaint fully.
    this.context.setTransform(ratio, 0, 0, ratio, 0, 0);
    this.applyFont();
    this.context.fillStyle = this.lastBackground;
    this.context.fillRect(0, 0, cssWidth, cssHeight);
    return {
      cols: Math.max(1, Math.floor(cssWidth / this.cell.width)),
      rows: Math.max(1, Math.floor(cssHeight / this.cell.height)),
    };
  }

  paint(frame: Frame): void {
    if (frame.dirty === "none") return;
    this.lastBackground = frame.background;
    this.applyFont();
    for (const row of frame.dirtyRows) this.paintRow(row, frame);
    if (frame.cursor) this.paintCursor(frame);
  }

  private paintRow(row: FrameRow, frame: Frame): void {
    const { width, height, baseline } = this.cell;
    const y = row.y * height;
    const context = this.context;

    context.fillStyle = frame.background;
    context.fillRect(0, y, this.cssWidth(), height);

    let column = 0;
    for (const cell of row.cells) {
      const x = column * width;
      if (cell.bg !== frame.background) {
        context.fillStyle = cell.bg;
        context.fillRect(x, y, width, height);
      }
      if (cell.text) {
        this.applyFont(cell);
        context.fillStyle = cell.fg;
        context.fillText(cell.text, x, y + baseline);
        this.paintCellLines(cell, x, y);
      }
      column += 1;
    }
  }

  private paintCellLines(cell: FrameCell, x: number, y: number): void {
    const { width, height, baseline } = this.cell;
    if (!cell.underline && !cell.strikethrough) return;
    const context = this.context;
    context.fillStyle = cell.fg;
    const thickness = Math.max(1, Math.round(this.options.fontSize / 12));
    if (cell.underline) {
      context.fillRect(x, y + Math.min(height - thickness, baseline + 2), width, thickness);
    }
    if (cell.strikethrough) {
      context.fillRect(x, y + Math.round(height / 2), width, thickness);
    }
  }

  private paintCursor(frame: Frame): void {
    const cursor = frame.cursor;
    if (!cursor) return;
    // Only paint the cursor when its row was repainted this frame; otherwise
    // the previous frame's pixels there are still correct.
    if (!frame.dirtyRows.some((row) => row.y === cursor.y)) return;
    const { width, height } = this.cell;
    const x = cursor.x * width;
    const y = cursor.y * height;
    const context = this.context;
    context.fillStyle = frame.foreground;
    if (cursor.style === "bar") {
      context.fillRect(x, y, Math.max(1, Math.round(width / 6)), height);
      return;
    }
    if (cursor.style === "underline") {
      const thickness = Math.max(1, Math.round(height / 10));
      context.fillRect(x, y + height - thickness, width, thickness);
      return;
    }
    if (cursor.style === "block_hollow") {
      context.strokeStyle = frame.foreground;
      context.lineWidth = 1;
      context.strokeRect(x + 0.5, y + 0.5, width - 1, height - 1);
      return;
    }
    context.globalCompositeOperation = "difference";
    context.fillRect(x, y, width, height);
    context.globalCompositeOperation = "source-over";
  }

  private applyFont(cell?: FrameCell): void {
    const weight = cell?.bold ? "bold" : "normal";
    const style = cell?.italic ? "italic" : "normal";
    this.context.font = `${style} ${weight} ${this.options.fontSize}px ${this.options.fontFamily}`;
    this.context.textBaseline = "alphabetic";
  }

  private cssWidth(): number {
    return this.canvas.width / this.options.pixelRatio;
  }

  private measureCell(): CellMetrics {
    this.applyFont();
    const metrics = this.context.measureText("M");
    // jsdom reports zero-width text; fall back to a plausible monospace box so
    // geometry maths stays finite in tests.
    const width = metrics.width > 0 ? metrics.width : this.options.fontSize * 0.6;
    const height = Math.ceil(this.options.fontSize * 1.35);
    const ascent =
      metrics.actualBoundingBoxAscent > 0
        ? metrics.actualBoundingBoxAscent
        : this.options.fontSize * 0.8;
    return {
      width,
      height,
      baseline: Math.min(height - 1, Math.round((height + ascent) / 2)),
    };
  }
}

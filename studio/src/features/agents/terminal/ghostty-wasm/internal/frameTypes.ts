/**
 * CODING-1304 — the frame shape the Canvas painter consumes.
 *
 * Plain data by design: a frame crosses from the wasm binding to the renderer
 * without carrying handles, so nothing downstream can reach back into Ghostty
 * memory after the frame was produced.
 */

export interface FrameCell {
  /** The cell's grapheme cluster, or "" for an empty cell. */
  text: string;
  /** Resolved `#rrggbb`; Ghostty applies palette, inverse and selection. */
  fg: string;
  bg: string;
  bold: boolean;
  italic: boolean;
  underline: boolean;
  strikethrough: boolean;
  selected: boolean;
}

export interface FrameRow {
  y: number;
  cells: FrameCell[];
}

export type FrameCursorStyle = "bar" | "block" | "underline" | "block_hollow";

export interface FrameCursor {
  visible: boolean;
  blinking: boolean;
  x: number;
  y: number;
  style: FrameCursorStyle;
}

export interface FrameColors {
  background: string;
  foreground: string;
}

export interface Frame {
  cols: number;
  rows: number;
  /** `full` repaints every row; `partial` repaints `dirtyRows` only. */
  dirty: "none" | "partial" | "full";
  background: string;
  foreground: string;
  cursor: FrameCursor | null;
  dirtyRows: FrameRow[];
}

/**
 * CODING-1304 — the libghostty-vt enum members this experiment names.
 *
 * Members are looked up by name in the artifact's ABI manifest, never by
 * hardcoded ordinal, so re-pinning the artifact surfaces a removed member as a
 * load-time error instead of silently reading the wrong field.
 */
import type { GhosttyVtRuntime } from "./wasmRuntime";

export interface GhosttyVtAbi {
  terminalData: {
    cols: number;
    rows: number;
    title: number;
    mouseTracking: number;
  };
  renderData: {
    dirty: number;
    cols: number;
    rows: number;
    colors: number;
    cursor: number;
    rowIterator: number;
  };
  renderOption: {
    dirty: number;
  };
  rowData: {
    cells: number;
    selection: number;
  };
  cellData: {
    graphemesLen: number;
    graphemesBuf: number;
    style: number;
    bgColor: number;
    fgColor: number;
    selected: number;
  };
  dirty: {
    false: number;
    partial: number;
    full: number;
  };
  cursorStyle: {
    bar: number;
    block: number;
    underline: number;
    blockHollow: number;
  };
  keyAction: {
    press: number;
    release: number;
    repeat: number;
  };
  /** Result codes the readers branch on. */
  success: number;
  noValue: number;
}

/** Resolve every enum member this experiment uses, once per runtime. */
export function resolveGhosttyVtAbi(runtime: GhosttyVtRuntime): GhosttyVtAbi {
  const value = (type: string, member: string) => runtime.enumValue(type, member);
  return {
    terminalData: {
      cols: value("GhosttyTerminalData", "COLS"),
      rows: value("GhosttyTerminalData", "ROWS"),
      title: value("GhosttyTerminalData", "TITLE"),
      mouseTracking: value("GhosttyTerminalData", "MOUSE_TRACKING"),
    },
    renderData: {
      dirty: value("GhosttyRenderStateData", "DIRTY"),
      cols: value("GhosttyRenderStateData", "COLS"),
      rows: value("GhosttyRenderStateData", "ROWS"),
      colors: value("GhosttyRenderStateData", "COLORS"),
      cursor: value("GhosttyRenderStateData", "CURSOR"),
      rowIterator: value("GhosttyRenderStateData", "ROW_ITERATOR"),
    },
    renderOption: {
      dirty: value("GhosttyRenderStateOption", "DIRTY"),
    },
    rowData: {
      cells: value("GhosttyRenderStateRowData", "CELLS"),
      selection: value("GhosttyRenderStateRowData", "SELECTION"),
    },
    cellData: {
      graphemesLen: value("GhosttyRenderStateRowCellsData", "GRAPHEMES_LEN"),
      graphemesBuf: value("GhosttyRenderStateRowCellsData", "GRAPHEMES_BUF"),
      style: value("GhosttyRenderStateRowCellsData", "STYLE"),
      bgColor: value("GhosttyRenderStateRowCellsData", "BG_COLOR"),
      fgColor: value("GhosttyRenderStateRowCellsData", "FG_COLOR"),
      selected: value("GhosttyRenderStateRowCellsData", "SELECTED"),
    },
    dirty: {
      false: value("GhosttyRenderStateDirty", "FALSE"),
      partial: value("GhosttyRenderStateDirty", "PARTIAL"),
      full: value("GhosttyRenderStateDirty", "FULL"),
    },
    cursorStyle: {
      bar: value("GhosttyRenderStateCursorVisualStyle", "BAR"),
      block: value("GhosttyRenderStateCursorVisualStyle", "BLOCK"),
      underline: value("GhosttyRenderStateCursorVisualStyle", "UNDERLINE"),
      blockHollow: value("GhosttyRenderStateCursorVisualStyle", "BLOCK_HOLLOW"),
    },
    keyAction: {
      press: value("GhosttyKeyAction", "PRESS"),
      release: value("GhosttyKeyAction", "RELEASE"),
      repeat: value("GhosttyKeyAction", "REPEAT"),
    },
    success: runtime.enumValue("GhosttyResult", "SUCCESS"),
    noValue: runtime.enumValue("GhosttyResult", "NO_VALUE"),
  };
}

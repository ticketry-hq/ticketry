import { create } from "zustand";

// Multi-select (#637). A small, layout-agnostic store: it tracks *which* work
// items are selected and on *which* surface, but knows nothing about trees,
// columns, or collapse state. A range select is resolved against an ordered-id
// list the view computes at click time and passes into `range()`, so the store
// never has to mirror the rendered order.

/** The surface that owns the current selection. Selection is per-surface. */
export type SelectionSurface = "backlog";

interface SelectionState {
  /** Which view owns the live selection, or null when nothing is selected. */
  surface: SelectionSurface | null;
  /** Selected work-item UUIDs (stories & sub-tasks only). */
  ids: Set<string>;
  /** The fixed end of a Shift range — the last toggle/plain-selected id. */
  anchorId: string | null;

  /**
   * ⌘/Ctrl-click: add/remove `id` and pin it as the range anchor. A click on a
   * different surface than the live selection resets it first.
   */
  toggle: (surface: SelectionSurface, id: string) => void;
  /**
   * Shift-click: union in the inclusive slice of `orderedIds` between the
   * anchor and `id`; the anchor is left unchanged. With no anchor (or a
   * surface switch, or ids absent from the list) it degrades to a toggle.
   */
  range: (surface: SelectionSurface, id: string, orderedIds: string[]) => void;
  /** Replace the selection wholesale (e.g. trim to the survivors of a bulk op). */
  replace: (surface: SelectionSurface, ids: string[]) => void;
  /** Empty the set, drop the anchor and the surface. */
  clear: () => void;
}

export const useSelectionStore = create<SelectionState>((set, get) => ({
  surface: null,
  ids: new Set(),
  anchorId: null,

  toggle(surface, id) {
    const st = get();
    // Switching surfaces starts a fresh selection on the new surface.
    const ids = st.surface === surface ? new Set(st.ids) : new Set<string>();
    if (ids.has(id)) ids.delete(id);
    else ids.add(id);
    set({ surface, ids, anchorId: id });
  },

  range(surface, id, orderedIds) {
    const st = get();
    if (st.surface !== surface || st.anchorId === null) {
      get().toggle(surface, id);
      return;
    }
    const ai = orderedIds.indexOf(st.anchorId);
    const ti = orderedIds.indexOf(id);
    if (ai === -1 || ti === -1) {
      get().toggle(surface, id);
      return;
    }
    const [lo, hi] = ai <= ti ? [ai, ti] : [ti, ai];
    const ids = new Set(st.ids);
    for (let k = lo; k <= hi; k += 1) ids.add(orderedIds[k]);
    set({ surface, ids }); // anchor unchanged
  },

  replace(surface, ids) {
    set({ surface, ids: new Set(ids), anchorId: null });
  },

  clear() {
    set({ surface: null, ids: new Set(), anchorId: null });
  },
}));

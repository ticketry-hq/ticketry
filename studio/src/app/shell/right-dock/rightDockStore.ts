import { create } from "zustand";

export const RIGHT_DOCK_DEFAULT_WIDTH = 28;
export const RIGHT_DOCK_MIN_WIDTH = 20;
export const RIGHT_DOCK_MAX_WIDTH = 45;

interface RightDockState {
  open: boolean;
  selectedViewId: string | null;
  width: number;
  toggleView: (viewId: string, available: boolean) => void;
  close: () => void;
  setWidth: (width: number) => void;
}

const clampWidth = (width: number) =>
  Math.min(RIGHT_DOCK_MAX_WIDTH, Math.max(RIGHT_DOCK_MIN_WIDTH, width));

export const useRightDockStore = create<RightDockState>((set) => ({
  open: false,
  selectedViewId: null,
  width: RIGHT_DOCK_DEFAULT_WIDTH,

  toggleView(viewId, available) {
    if (!available) return;
    set((state) =>
      state.open && state.selectedViewId === viewId
        ? { open: false }
        : { open: true, selectedViewId: viewId },
    );
  },

  close() {
    set({ open: false });
  },

  setWidth(width) {
    set({ width: clampWidth(width) });
  },
}));

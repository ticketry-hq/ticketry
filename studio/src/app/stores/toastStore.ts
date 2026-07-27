import { create } from "zustand";

// C3 (#638) toast system (G16): a transient feedback channel for mutations.
// Error toasts fire on every failed mutation (the optimistic rollback case);
// success toasts fire only for discrete/destructive actions. The store is
// surfaced once by ToastHost at the app root.

export type ToastKind = "success" | "error";

export interface Toast {
  id: number;
  kind: ToastKind;
  message: string;
}

interface ToastState {
  toasts: Toast[];
  /** Push a toast; returns its id. Both kinds auto-dismiss (errors linger longer). */
  push: (kind: ToastKind, message: string) => number;
  dismiss: (id: number) => void;
}

// Auto-dismiss windows. Errors get a longer window than success so a failed
// mutation stays readable, but neither kind sticks around indefinitely.
const SUCCESS_TTL_MS = 4000;
const ERROR_TTL_MS = 8000;

// A monotonic id source — a counter (not Math.random/Date.now) so ids are
// stable and unique across a session without relying on wall-clock state.
let seq = 0;

export const useToastStore = create<ToastState>((set, get) => ({
  toasts: [],

  push(kind, message) {
    const id = ++seq;
    set({ toasts: [...get().toasts, { id, kind, message }] });
    setTimeout(() => get().dismiss(id), kind === "error" ? ERROR_TTL_MS : SUCCESS_TTL_MS);
    return id;
  },

  dismiss(id) {
    set({ toasts: get().toasts.filter((t) => t.id !== id) });
  },
}));

// Thin helpers callable from non-hook store code (mutation catches) via
// getState() — no prop-drilling, no React context.
export const toast = {
  success: (message: string) => useToastStore.getState().push("success", message),
  error: (message: string) => useToastStore.getState().push("error", message),
};

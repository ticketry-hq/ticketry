import { createApolloStore } from "../../shared/apollo/localState";

export type ToastKind = "success" | "info" | "error";

export interface Toast {
  id: number;
  kind: ToastKind;
  message: string;
}

interface ToastState {
  toasts: Toast[];
  pushToast: (kind: ToastKind, message: string) => number;
  dismissToast: (id: number) => void;
}

const SUCCESS_TTL_MS = 4_000;
const ERROR_TTL_MS = 8_000;
let toastSequence = 0;

export const useToastStore = createApolloStore<ToastState>("shell-toasts", (set, get) => ({
  toasts: [],
  pushToast(kind, message) {
    const id = ++toastSequence;
    set((state) => ({ toasts: [...state.toasts, { id, kind, message }] }));
    setTimeout(
      () => get().dismissToast(id),
      kind === "error" ? ERROR_TTL_MS : SUCCESS_TTL_MS,
    );
    return id;
  },
  dismissToast(id) {
    set((state) => ({ toasts: state.toasts.filter((toast) => toast.id !== id) }));
  },
}));

export const toast = {
  success: (message: string) => useToastStore.getState().pushToast("success", message),
  info: (message: string) => useToastStore.getState().pushToast("info", message),
  error: (message: string) => useToastStore.getState().pushToast("error", message),
};

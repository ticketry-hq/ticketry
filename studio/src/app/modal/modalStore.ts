import { create } from "zustand";

export interface ModalDescriptor {
  type:
    | "agent-picker"
    | "prompt-input"
    | "module-folder"
    | "keyboard-shortcuts"
    | "settings"
    | "status-update"
    | "parent-update"
    | "add-project"
    | "add-module";
  payload?: Record<string, unknown>;
}

export interface ModalKeyBinding {
  actionId: string | readonly string[];
  label: string;
}

export interface ModalBindingHint {
  key: string;
  label: string;
}

interface ModalState {
  modalStack: ModalDescriptor[];
  activeBindings: ModalBindingHint[] | null;
  pushModal: (modal: ModalDescriptor) => void;
  openKeyboardShortcuts: () => void;
  openSettings: () => void;
  popModal: () => void;
  setActiveBindings: (bindings: ModalBindingHint[] | null) => void;
}

export const useModalStore = create<ModalState>((set) => ({
  modalStack: [],
  activeBindings: null,
  pushModal: (modal) =>
    set((state) => ({ modalStack: [...state.modalStack, modal] })),
  openKeyboardShortcuts: () =>
    set((state) =>
      state.modalStack.length > 0
        ? state
        : { modalStack: [{ type: "keyboard-shortcuts" }] },
    ),
  // Settings is a singleton overlay: pointer activation can repeat before the
  // UI rerenders, so make its open path idempotent at the store boundary.
  openSettings: () =>
    set((state) =>
      state.modalStack.some((modal) => modal.type === "settings")
        ? state
        : { modalStack: [...state.modalStack, { type: "settings" }] },
    ),
  popModal: () =>
    set((state) => ({ modalStack: state.modalStack.slice(0, -1) })),
  setActiveBindings: (activeBindings) => set({ activeBindings }),
}));

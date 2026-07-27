import { create } from "zustand";

// C3 (#638) imperative dialog API (G01 delete-confirm, G17 reassign). A click
// handler `await`s confirm()/reassign() and gets the user's answer back as a
// promise — DialogHost renders the active dialog through the shared Modal and
// resolves it. This replaces the browser window.confirm/prompt flows.

export interface ConfirmOptions {
  title: string;
  body: string;
  confirmLabel?: string;
  /** Style the confirm button as destructive (red). */
  danger?: boolean;
}

// confirmTyped (#665): a destructive confirm gated on the user typing an exact
// string (a project key) before the confirm button enables — the no-undo
// guard for permanent project deletion.
export interface ConfirmTypedOptions extends ConfirmOptions {
  /** The exact text the user must type to enable confirm (e.g. the key). */
  confirmText: string;
}

export interface ReassignCandidate {
  id: string;
  name: string;
}

export interface ReassignOptions {
  title: string;
  itemName: string;
  candidates: ReassignCandidate[];
}

// reassign() resolves to:
//   null               → cancelled (no deletion)
//   { }                → delete only if unused (no reassignment target)
//   { reassignTo: id } → reassign open issues to this target, then delete
export type ReassignResult = { reassignTo?: string } | null;

type ActiveDialog =
  | { kind: "confirm"; opts: ConfirmOptions; resolve: (v: boolean) => void }
  | { kind: "confirmTyped"; opts: ConfirmTypedOptions; resolve: (v: boolean) => void }
  | { kind: "reassign"; opts: ReassignOptions; resolve: (v: ReassignResult) => void };

interface DialogState {
  active: ActiveDialog | null;
  confirm: (opts: ConfirmOptions) => Promise<boolean>;
  confirmTyped: (opts: ConfirmTypedOptions) => Promise<boolean>;
  reassign: (opts: ReassignOptions) => Promise<ReassignResult>;
}

export const useDialogStore = create<DialogState>((set) => ({
  active: null,

  confirm(opts) {
    return new Promise<boolean>((resolve) => {
      set({
        active: {
          kind: "confirm",
          opts,
          resolve: (v) => {
            set({ active: null });
            resolve(v);
          },
        },
      });
    });
  },

  confirmTyped(opts) {
    return new Promise<boolean>((resolve) => {
      set({
        active: {
          kind: "confirmTyped",
          opts,
          resolve: (v) => {
            set({ active: null });
            resolve(v);
          },
        },
      });
    });
  },

  reassign(opts) {
    return new Promise<ReassignResult>((resolve) => {
      set({
        active: {
          kind: "reassign",
          opts,
          resolve: (v) => {
            set({ active: null });
            resolve(v);
          },
        },
      });
    });
  },
}));

// Non-hook helpers so handlers can await the dialog without subscribing.
export const dialog = {
  confirm: (opts: ConfirmOptions) => useDialogStore.getState().confirm(opts),
  confirmTyped: (opts: ConfirmTypedOptions) =>
    useDialogStore.getState().confirmTyped(opts),
  reassign: (opts: ReassignOptions) => useDialogStore.getState().reassign(opts),
};

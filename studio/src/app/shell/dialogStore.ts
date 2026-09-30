import { createApolloStore } from "../../shared/apollo/localState";

export interface ConfirmOptions {
  title: string;
  body: string;
  confirmLabel?: string;
  danger?: boolean;
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

export type ReassignResult = { reassignTo?: string } | null;

export type DialogDescriptor =
  | { kind: "confirm"; opts: ConfirmOptions; resolve: (value: boolean) => void }
  | {
      kind: "reassign";
      opts: ReassignOptions;
      resolve: (value: ReassignResult) => void;
    };

interface DialogState {
  dialogs: DialogDescriptor[];
  confirm: (options: ConfirmOptions) => Promise<boolean>;
  reassign: (options: ReassignOptions) => Promise<ReassignResult>;
}

export const useDialogStore = createApolloStore<DialogState>("shell-dialogs", (set) => ({
  dialogs: [],
  confirm(options) {
    return new Promise<boolean>((resolve) => {
      const descriptor: DialogDescriptor = {
        kind: "confirm",
        opts: options,
        resolve: (value) => {
          set((state) => ({
            dialogs: state.dialogs.filter(
              (item) => item.resolve !== descriptor.resolve,
            ),
          }));
          resolve(value);
        },
      };
      set((state) => ({ dialogs: [...state.dialogs, descriptor] }));
    });
  },
  reassign(options) {
    return new Promise<ReassignResult>((resolve) => {
      const descriptor: DialogDescriptor = {
        kind: "reassign",
        opts: options,
        resolve: (value) => {
          set((state) => ({
            dialogs: state.dialogs.filter(
              (item) => item.resolve !== descriptor.resolve,
            ),
          }));
          resolve(value);
        },
      };
      set((state) => ({ dialogs: [...state.dialogs, descriptor] }));
    });
  },
}));

export const dialog = {
  confirm: (options: ConfirmOptions) => useDialogStore.getState().confirm(options),
  reassign: (options: ReassignOptions) => useDialogStore.getState().reassign(options),
};

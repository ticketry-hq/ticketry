import { createApolloStore } from "../../shared/apollo/localState";
import {
  validateUserNotice,
  type UserNotice,
} from "../../runtime/userNotice";
import {
  readPresentedNoticeIds,
  recordPresentedNoticeId,
} from "./presentedNoticeStore";

export type StandardModalType =
    | "agent-picker"
    | "prompt-input"
    | "module-folder"
    | "keyboard-shortcuts"
    | "settings"
    | "status-update"
    | "parent-update"
    | "add-project"
    | "add-module";

export interface StandardModalDescriptor {
  type: StandardModalType;
  payload?: Record<string, unknown>;
}

export interface NotifyUserModalDescriptor {
  type: "notify-user";
  payload: UserNotice;
}

export type ModalDescriptor =
  | StandardModalDescriptor
  | NotifyUserModalDescriptor;

export interface ModalKeyBinding {
  actionId: string | readonly string[];
  label: string;
}

interface ModalState {
  modalStack: ModalDescriptor[];
  presentedNoticeIds: ReadonlySet<string>;
  pushModal: (modal: StandardModalDescriptor) => void;
  notifyUser: (notice: UserNotice) => void;
  openKeyboardShortcuts: () => void;
  openSettings: () => void;
  popModal: () => void;
}

export const useModalStore = createApolloStore<ModalState>("modal", (set) => ({
  modalStack: [],
  // Seeded from window-session storage so notices already presented before an
  // in-app recovery refresh stay silent in the document that replaces it.
  presentedNoticeIds: new Set(readPresentedNoticeIds()),
  pushModal: (modal) =>
    set((state) => ({ modalStack: [...state.modalStack, modal] })),
  notifyUser: (candidate) =>
    set((state) => {
      const notice = validateUserNotice(candidate);
      if (!notice || state.presentedNoticeIds.has(notice.id)) return state;
      recordPresentedNoticeId(notice.id);
      const presentedNoticeIds = new Set(state.presentedNoticeIds);
      presentedNoticeIds.add(notice.id);
      return {
        modalStack: [
          ...state.modalStack,
          { type: "notify-user", payload: notice },
        ],
        presentedNoticeIds,
      };
    }),
  openKeyboardShortcuts: () =>
    set((state) =>
      state.modalStack.length > 0
        ? state
        : {
            modalStack: [
              { type: "settings", payload: { section: "keyboard-shortcuts" } },
            ],
          },
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
}));

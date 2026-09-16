import { useDialogStore } from "../../app/shell/dialogStore";
import { useToastStore } from "../../app/shell/toastStore";
import type { ClientState } from "./types";

// Compatibility reads never enter the workspace cache row or ordinary patches.
export const shellCompatibility = {
  prepare(state: ClientState) {
    const transient = state as unknown as Record<string, unknown>;
    if (Object.prototype.hasOwnProperty.call(transient, "dialogs")) {
      if (state.dialogs !== useDialogStore.getState().dialogs) {
        useDialogStore.setState({ dialogs: state.dialogs });
      }
      delete transient.dialogs;
    }
    if (Object.prototype.hasOwnProperty.call(transient, "toasts")) {
      if (state.toasts !== useToastStore.getState().toasts) {
        useToastStore.setState({ toasts: state.toasts });
      }
      delete transient.toasts;
    }
    delete transient.confirm;
    delete transient.reassign;
    delete transient.pushToast;
    delete transient.dismissToast;
  },
  derive(state: ClientState) {
    const dialogs = useDialogStore.getState();
    const toasts = useToastStore.getState();
    return Object.defineProperties({
      ...state,
      confirm: dialogs.confirm,
      reassign: dialogs.reassign,
      pushToast: toasts.pushToast,
      dismissToast: toasts.dismissToast,
    }, {
      dialogs: {
        enumerable: false,
        get: () => useDialogStore.getState().dialogs,
      },
      toasts: {
        enumerable: false,
        get: () => useToastStore.getState().toasts,
      },
    }) as ClientState;
  },
};

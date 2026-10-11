import { useModalStore } from "../../../../app/modal/modalStore";
import { useDialogStore } from "../../../../app/shell/dialogStore";
import { useClientStore } from "../../../../state/clientStore";
import { useModuleManagerStore } from "../../../module-manager/state";

/**
 * The single window-level occlusion condition (CODING-718, CODING-733).
 *
 * Studio raises WebView surfaces above the native terminal from the modal
 * stack, `DialogHost`, Module Manager, and the state-configuration overlay. Any one
 * of them owns the foreground, so the condition is centralized here rather
 * than bolted onto each terminal gate. While it holds, terminals stay
 * presented beneath dialogs as WebView siblings; Module Manager additionally
 * suppresses visibility. None may take focus or keyboard ownership.
 */
export function modalOcclusionActive(): boolean {
  return (
    useModuleManagerStore.getState().active ||
    useModalStore.getState().modalStack.length > 0 ||
    useDialogStore.getState().dialogs.length > 0 ||
    useClientStore.getState().workspaceSelection.kind.endsWith("-configuration")
  );
}

/**
 * The same condition as a reactive subscription, for hosts that must re-commit
 * native visibility the moment any overlay surface opens or closes.
 */
export function useModalOcclusionActive(): boolean {
  const modalOpen = useModalStore((state) => state.modalStack.length > 0);
  const managerOpen = useModuleManagerStore((state) => state.active);
  const dialogOpen = useDialogStore((state) => state.dialogs.length > 0);
  const workspaceOverlayOpen = useClientStore(
    (state) => state.workspaceSelection.kind.endsWith("-configuration"),
  );
  return modalOpen || dialogOpen || workspaceOverlayOpen || managerOpen;
}

/**
 * Observe the start of an occlusion episode: the window going from unoccluded
 * to occluded by any overlay surface. Terminal-side work banked while the
 * window was unoccluded uses this to abandon itself rather than resume against
 * a foreground the overlay has since taken over.
 */
export function onModalOcclusionBegin(listener: () => void): () => void {
  let occluded = modalOcclusionActive();
  const observe = () => {
    const next = modalOcclusionActive();
    const began = next && !occluded;
    occluded = next;
    if (began) listener();
  };
  const releases = [
    useModalStore.subscribe(observe),
    useDialogStore.subscribe(observe),
    useClientStore.subscribe(observe),
    useModuleManagerStore.subscribe(observe),
  ];
  return () => {
    for (const release of releases) release();
  };
}

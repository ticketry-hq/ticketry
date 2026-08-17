import { useModalStore } from "../../../../app/modal/modalStore";
import { useClientStore } from "../../../../state/clientStore";

/**
 * The single window-level occlusion condition (CODING-718, CODING-733).
 *
 * Studio raises window-level overlays from two independent surfaces: the modal
 * stack `ModalHost` renders, and the confirm dialogs `DialogHost` renders from
 * `useClientStore.dialogs`. Either one owns the window foreground, so the
 * condition is the OR over both rather than a second per-surface rule bolted
 * onto each terminal gate. While it holds, no terminal may be presented and
 * none may hold the window's focus. Reading it through one named predicate
 * keeps every terminal-side gate on the same source of intent instead of each
 * surface re-deriving its own notion of "a dialog is up".
 */
export function modalOcclusionActive(): boolean {
  return (
    useModalStore.getState().modalStack.length > 0 ||
    useClientStore.getState().dialogs.length > 0
  );
}

/**
 * The same condition as a reactive subscription, for hosts that must re-commit
 * native visibility the moment any overlay surface opens or closes.
 */
export function useModalOcclusionActive(): boolean {
  const modalOpen = useModalStore((state) => state.modalStack.length > 0);
  const dialogOpen = useClientStore((state) => state.dialogs.length > 0);
  return modalOpen || dialogOpen;
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
    useClientStore.subscribe(observe),
  ];
  return () => {
    for (const release of releases) release();
  };
}

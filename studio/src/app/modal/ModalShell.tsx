import type { KeyboardEvent } from "react";
import { ModalSurface, type ModalSurfaceProps } from "../../shared/ui/ModalSurface";
import { MODAL_ACTIONS, studioKeymapRegistry } from "../navigation/keymapRegistry";
import { useModalStore, type ModalKeyBinding } from "./modalStore";

type ModalShellProps = Omit<ModalSurfaceProps, "onClose" | "onKeyDownCapture"> & {
  onClose?: () => void;
  bindings?: ModalKeyBinding[];
  onAction?: (actionId: string) => void;
  interceptKeyDown?: (event: globalThis.KeyboardEvent) => boolean;
};

export function ModalShell({ bindings, onClose, onAction, interceptKeyDown, ...surfaceProps }: ModalShellProps) {
  const popModal = useModalStore((state) => state.popModal);
  function handleKey(event: KeyboardEvent<HTMLDivElement>): void {
    if (event.defaultPrevented) return;
    if (interceptKeyDown?.(event.nativeEvent)) {
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    if (event.key === "Escape") return;
    const actionIds = new Set(
      bindings?.flatMap(({ actionId }) =>
        typeof actionId === "string" ? [actionId] : actionId,
      ),
    );
    const actionId = studioKeymapRegistry.resolve("modal", event.nativeEvent, actionIds);
    if (!actionId || actionId === MODAL_ACTIONS.close) return;
    event.preventDefault();
    event.stopPropagation();
    onAction?.(actionId);
  }
  return <ModalSurface {...surfaceProps} onClose={onClose ?? popModal} onKeyDownCapture={handleKey} />;
}

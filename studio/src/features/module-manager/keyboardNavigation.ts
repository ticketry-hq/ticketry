import { isTypingTarget } from "../../shared/utilities/keyboard";
import { cancelModuleManagerCreation, closeModuleManager, useModuleManagerStore } from "./state";
import { cancelModuleManagerRename } from "./useManagerRename";

type ManagerKeyboardHandler = (event: KeyboardEvent) => boolean;
let handler: ManagerKeyboardHandler | null = null;

/** The application keymap owns event precedence; the view supplies only its current DOM navigation. */
export function registerModuleManagerKeyboardHandler(next: ManagerKeyboardHandler): () => void {
  handler = next;
  return () => { if (handler === next) handler = null; };
}

export function routeModuleManagerKeyboardNavigation(event: KeyboardEvent): boolean {
  if (!useModuleManagerStore.getState().active || event.defaultPrevented) return false;
  if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return false;
  if (event.key === "Escape") {
    event.preventDefault();
    event.stopPropagation();
    if (useModuleManagerStore.getState().renameEdit) cancelModuleManagerRename();
    else if (useModuleManagerStore.getState().creationActive) cancelModuleManagerCreation();
    else closeModuleManager();
    return true;
  }
  if (isTypingTarget(event.target)) return false;
  return handler?.(event) ?? false;
}

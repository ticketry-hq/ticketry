const NATIVE_TERMINAL_KEYBOARD_ENGAGED_EVENT =
  "ticketry:native-terminal-keyboard-engaged";

/** Reports that the native terminal is about to take keyboard ownership. */
export function notifyNativeTerminalKeyboardEngaged(): void {
  window.dispatchEvent(new Event(NATIVE_TERMINAL_KEYBOARD_ENGAGED_EVENT));
}

/** Subscribes to native terminal keyboard-ownership transitions. */
export function onNativeTerminalKeyboardEngaged(
  listener: () => void,
): () => void {
  window.addEventListener(NATIVE_TERMINAL_KEYBOARD_ENGAGED_EVENT, listener);
  return () =>
    window.removeEventListener(NATIVE_TERMINAL_KEYBOARD_ENGAGED_EVENT, listener);
}

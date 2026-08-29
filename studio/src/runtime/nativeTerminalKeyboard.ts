const NATIVE_TERMINAL_KEYBOARD_ENGAGED_EVENT =
  "ticketry:native-terminal-keyboard-engaged";

export function notifyNativeTerminalKeyboardEngaged(): void {
  window.dispatchEvent(new Event(NATIVE_TERMINAL_KEYBOARD_ENGAGED_EVENT));
}

export function onNativeTerminalKeyboardEngaged(
  listener: () => void,
): () => void {
  window.addEventListener(NATIVE_TERMINAL_KEYBOARD_ENGAGED_EVENT, listener);
  return () =>
    window.removeEventListener(NATIVE_TERMINAL_KEYBOARD_ENGAGED_EVENT, listener);
}

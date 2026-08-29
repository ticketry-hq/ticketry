const NATIVE_TERMINAL_KEYBOARD_ENGAGED_EVENT =
  "ticketry:native-terminal-keyboard-engaged";

export interface NativeTerminalKeyboardOwner {
  handle: string;
  runId: string;
}

const keyboardOwnerClaims = new Map<string, number>();

function ownerKey({ handle, runId }: NativeTerminalKeyboardOwner): string {
  return `${handle}\u0000${runId}`;
}

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

/** Marks one presented viewer as eligible to report keyboard-owner events. */
export function registerNativeTerminalKeyboardOwner(
  owner: NativeTerminalKeyboardOwner,
): () => void {
  const key = ownerKey(owner);
  keyboardOwnerClaims.set(key, (keyboardOwnerClaims.get(key) ?? 0) + 1);
  let active = true;
  return () => {
    if (!active) return;
    active = false;
    const claims = keyboardOwnerClaims.get(key) ?? 0;
    if (claims <= 1) keyboardOwnerClaims.delete(key);
    else keyboardOwnerClaims.set(key, claims - 1);
  };
}

/** True only while this exact native viewer owns an unoccluded host. */
export function isNativeTerminalKeyboardOwner(
  owner: NativeTerminalKeyboardOwner,
): boolean {
  return keyboardOwnerClaims.has(ownerKey(owner));
}

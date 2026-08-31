/**
 * CODING-1304 — DOM `KeyboardEvent.code` to `GhosttyKey` member names.
 *
 * Both vocabularies are derived from the W3C UI Events code list, so one
 * mechanical rule covers almost all of it: split the camel-cased code into
 * SCREAMING_SNAKE_CASE and separate trailing digits. The exceptions are the
 * `KeyX` letter prefix and the function keys, which carry no separator.
 *
 * The result is looked up in the artifact's ABI manifest, so a name this rule
 * produces that Ghostty does not define degrades to UNIDENTIFIED rather than
 * encoding the wrong key.
 */

/** Modifier bits from `ghostty/vt/key/event.h`; macros, so not in the manifest. */
export const GHOSTTY_MOD_SHIFT = 1 << 0;
export const GHOSTTY_MOD_CTRL = 1 << 1;
export const GHOSTTY_MOD_ALT = 1 << 2;
export const GHOSTTY_MOD_SUPER = 1 << 3;
export const GHOSTTY_MOD_CAPS_LOCK = 1 << 4;
export const GHOSTTY_MOD_NUM_LOCK = 1 << 5;

const FUNCTION_KEY = /^F([1-9]|1[0-9]|2[0-5])$/;

/** Translate one `KeyboardEvent.code` into a `GhosttyKey` member name. */
export function ghosttyKeyName(code: string): string {
  if (!code) return "UNIDENTIFIED";
  if (FUNCTION_KEY.test(code)) return code.toUpperCase();
  if (code.startsWith("Key") && code.length === 4) return code.slice(3).toUpperCase();
  return code
    .replace(/([a-z])([A-Z])/g, "$1_$2")
    .replace(/([A-Za-z])(\d)/g, "$1_$2")
    .toUpperCase();
}

/** Collect Ghostty modifier bits from a DOM keyboard event. */
export function ghosttyMods(event: {
  shiftKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  metaKey: boolean;
  getModifierState?: (key: string) => boolean;
}): number {
  let mods = 0;
  if (event.shiftKey) mods |= GHOSTTY_MOD_SHIFT;
  if (event.ctrlKey) mods |= GHOSTTY_MOD_CTRL;
  if (event.altKey) mods |= GHOSTTY_MOD_ALT;
  if (event.metaKey) mods |= GHOSTTY_MOD_SUPER;
  if (event.getModifierState?.("CapsLock")) mods |= GHOSTTY_MOD_CAPS_LOCK;
  if (event.getModifierState?.("NumLock")) mods |= GHOSTTY_MOD_NUM_LOCK;
  return mods;
}

/**
 * The text a key would produce with no shift applied, used by the Kitty
 * protocol's alternate-key reporting. Only the codes whose unshifted value is
 * fixed by the code itself are reported; anything else stays 0.
 */
export function unshiftedCodepoint(code: string): number {
  if (code.startsWith("Key") && code.length === 4) {
    return code.charCodeAt(3) + 32; // "KeyA" -> "a"
  }
  if (code.startsWith("Digit") && code.length === 6) {
    return code.charCodeAt(5);
  }
  const punctuation: Record<string, string> = {
    Backquote: "`",
    Backslash: "\\",
    BracketLeft: "[",
    BracketRight: "]",
    Comma: ",",
    Equal: "=",
    Minus: "-",
    Period: ".",
    Quote: "'",
    Semicolon: ";",
    Slash: "/",
    Space: " ",
  };
  const value = punctuation[code];
  return value ? value.codePointAt(0) ?? 0 : 0;
}

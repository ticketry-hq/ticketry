import type { KeyChord } from "./keymapRegistry";

/**
 * Renders a chord in symbol form (⌘⌃⌥⇧ + key), the compact style used by the
 * footer key chips and the engaged-terminal tag. ModalShell deliberately keeps
 * its own spelled-out "Cmd+Esc" variant for prose-sized labels.
 */
export function formatChordSymbols(chord: KeyChord): string {
  const modifiers = [
    chord.meta ? "⌘" : "",
    chord.control ? "⌃" : "",
    chord.alt ? "⌥" : "",
    chord.shift ? "⇧" : "",
  ].join("");
  const key =
    {
      ArrowUp: "↑",
      ArrowDown: "↓",
      ArrowLeft: "←",
      ArrowRight: "→",
      Escape: "Esc",
    }[chord.key] ??
    (chord.key === "|" && chord.shift ? "\\" : chord.key);
  return `${modifiers}${key}`;
}

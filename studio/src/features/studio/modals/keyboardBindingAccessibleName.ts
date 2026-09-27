// Structural copy of the keymap's KeyChord; features may not import app types.
interface KeyChord {
  key: string;
  alt: boolean;
  control: boolean;
  meta: boolean;
  shift: boolean;
}

const ACCESSIBLE_KEY_NAMES: Record<string, string> = {
  Escape: "Escape",
  ArrowDown: "Down Arrow",
  ArrowUp: "Up Arrow",
  ArrowLeft: "Left Arrow",
  ArrowRight: "Right Arrow",
  " ": "Space",
  "/": "Slash",
  "\\": "Backslash",
  "|": "Vertical Bar",
  "`": "Grave Accent",
  ")": "Right Parenthesis",
  "?": "Question Mark",
  ",": "Comma",
  ".": "Period",
  ";": "Semicolon",
  "'": "Apostrophe",
  "[": "Left Bracket",
  "]": "Right Bracket",
  "-": "Minus",
  "=": "Equals",
};

function formatAccessibleKeyChord(chord: KeyChord): string {
  const key = ACCESSIBLE_KEY_NAMES[chord.key] ??
    (chord.key.length === 1 ? chord.key.toUpperCase() : chord.key);
  return [
    chord.control && "Control",
    chord.alt && "Alt",
    chord.shift && "Shift",
    chord.meta && "Command",
    key,
  ]
    .filter(Boolean)
    .join("+");
}

export function bindingControlAccessibleName(
  label: string,
  chord: KeyChord | null,
  recording: boolean,
  locked: boolean,
): string {
  const current = chord
    ? `current shortcut ${formatAccessibleKeyChord(chord)}`
    : "no shortcut assigned";
  if (locked) return `${label}, ${current}, locked`;
  if (recording) {
    return `${label}, ${current}, recording, press a new shortcut`;
  }
  return `${label}, ${current}, ${chord ? "change" : "set"} binding`;
}

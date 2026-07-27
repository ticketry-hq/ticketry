import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { Prec, type Extension } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { tags } from "@lezer/highlight";

// MDXEditor hardwires `cm6-theme-basic-light` into every code block. Passing
// these through `codeMirrorPlugin({ codeMirrorExtensions })` at the highest
// precedence puts Studio's dark palette back on top of it.

const surface = "#0f1116";
const border = "#2a2f3a";
const foreground = "#d6deeb";
const muted = "#7a8599";

const darkTheme = EditorView.theme(
  {
    "&": { backgroundColor: surface, color: foreground },
    ".cm-content": { caretColor: "#7aa2f7" },
    ".cm-cursor, .cm-dropCursor": { borderLeftColor: "#7aa2f7" },
    "&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection":
      { backgroundColor: "#2d3a5a" },
    ".cm-activeLine": { backgroundColor: "#1a1d24" },
    ".cm-gutters": {
      backgroundColor: surface,
      color: muted,
      border: "none",
      borderRight: `1px solid ${border}`,
    },
    ".cm-activeLineGutter": { backgroundColor: "#1a1d24", color: foreground },
    ".cm-selectionMatch": { backgroundColor: "#2d3a5a" },
    ".cm-tooltip": {
      backgroundColor: "#1f2530",
      border: `1px solid ${border}`,
      color: foreground,
    },
  },
  { dark: true },
);

const darkHighlightStyle = HighlightStyle.define([
  { tag: tags.comment, color: muted, fontStyle: "italic" },
  { tag: [tags.keyword, tags.modifier, tags.self], color: "#bb9af7" },
  { tag: [tags.string, tags.special(tags.string)], color: "#9ece6a" },
  { tag: [tags.number, tags.bool, tags.null], color: "#ff9e64" },
  { tag: [tags.function(tags.variableName), tags.labelName], color: "#7aa2f7" },
  { tag: [tags.typeName, tags.className, tags.namespace], color: "#2ac3de" },
  { tag: [tags.propertyName, tags.attributeName], color: "#7dcfff" },
  { tag: [tags.operator, tags.punctuation, tags.separator], color: "#89ddff" },
  { tag: [tags.heading, tags.strong], color: "#7aa2f7", fontWeight: "bold" },
  { tag: tags.emphasis, fontStyle: "italic" },
  { tag: tags.link, color: "#7dcfff", textDecoration: "underline" },
  { tag: tags.invalid, color: "#f7768e" },
]);

export const codeMirrorDarkExtensions: Extension[] = [
  Prec.highest([darkTheme, syntaxHighlighting(darkHighlightStyle)]),
];

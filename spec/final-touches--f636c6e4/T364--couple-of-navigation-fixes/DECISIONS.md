# T364 — Couple of navigation fixes: grill decisions

Ticket #364 · Work Item `9d122c40-698f-4f39-a2ac-f2218f4f345d` · Grilled 2026-08-14

## Decisions

1. **Right dives into the Active tab body.** In the Edit view's Stories zone,
   ArrowRight on a story enters the Active tab's body directly — the same
   destination as Enter — instead of landing on the workspace tab-strip
   highlight. The tab strip stays reachable via ArrowUp from the body and via
   Shift+Tab zone cycling.
2. **Expand-first is preserved.** ArrowRight on a story with collapsed children
   still expands it; Right only dives when the row has nothing left to expand.
   Left/Right stay symmetric for collapse/expand within the tree.
3. **Up-from-body needs no change.** "Hitting up from the story takes you to
   tabs" is today's behavior: ArrowUp inside the tab body moves to the
   workspace tab strip (Details → docs → terminals). Confirmed as-is.
4. **Fix #2 dropped.** "ArrowLeft from the caret's first position exits to the
   tickets list" is abandoned. Un-engaged tab bodies already exit on Left;
   inside engaged surfaces it is impractical for terminals (keystrokes belong
   to the shell/agent, whose cursor position Studio cannot know) and not worth
   doing for editors alone. Cmd+Esc remains the exit from engaged bodies.
5. **Edit view only.** The Right-dives change applies to the three-zone Edit
   view. The Full sidebar view keeps its current pane-focus arrows; its
   workspace pane continues to accept no arrow actions.
6. **Story row layout reverts to "ID · name" on the left.** The combined
   left-aligned label (identifier, separator dot, name in one truncating span)
   returns; the right edge of the row goes back to being empty. This undoes the
   row split from commit `4029746` that pushed the identifier to the right edge.

## Defaults taken without a decision (conventional)

* The identifier keeps its workflow-state color when it moves back to the left
  (the color was introduced alongside the split; reverting the layout does not
  require reverting the color).
* Tab-strip behaviors themselves (Left past the first tab falls back to the
  Stories pane; Down/Enter commit the highlight) are untouched.

## Docs written

* `studio/CONTEXT.md`: sharpened **Navigation mode** to record that Right on a
  fully expanded story dives into the active tab body.
* No ADR — the change is easily reversible, not surprising, and not the result
  of a hard trade-off.

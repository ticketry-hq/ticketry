# CODING-664 — Eliminate all rounded borders

## Problem Statement

Studio is meant to read like a terminal, but its surfaces do not. Buttons,
inputs, chips, pickers, popovers, modals, badges, dots and code blocks all
carried Tailwind `rounded*` utilities — 118 occurrences across 53 source files —
plus two hand-written radius declarations on the Backlog task focus frame. The
soft corners read as a conventional web application, which contradicts the
intended terminal aesthetic.

Two of the rounded surfaces are not ours to edit: MDXEditor's stylesheet (the
rich markdown editor) and xterm's stylesheet both declare their own radii, so
removing our utilities alone would leave rounded islands inside the editor and
the terminal viewport.

## Solution

Square every corner, at two seams.

1. **Studio source declares no radius.** Every `rounded*` utility is removed
   from `studio/src` — components, shared UI primitives, and the component
   layer of `app/styles/tailwind.css`. The task focus frame's
   `border-radius: 0.5rem` and its four `border-*-radius: inherit` corner
   brackets are removed with it; the brackets still hug the frame, now at right
   angles.

2. **A global flatten covers the CSS we do not own.** `app/styles/tailwind.css`
   adds one unconditional base rule:

   ```css
   *,
   *::before,
   *::after {
     border-radius: 0 !important;
   }
   ```

   `!important` is deliberate and load-order independent: MDXEditor and xterm
   declare their radii without `!important`, so this wins regardless of which
   stylesheet the bundler emits first (MDXEditor ships in a lazy chunk, so the
   order is not fixed).

No Tailwind theme token is overridden. The utilities are gone from the source
rather than silently neutered, so the file tree tells the truth: nothing in
Studio asks for a rounded corner.

Out of scope: the OS-drawn window corners of the desktop shell, which macOS
rounds and the application cannot control.

## Acceptance

`studio/src/test/overhaulSquareCornersAcceptance.test.tsx` holds the contract:

1. No Studio source file declares a `rounded*` utility.
2. No Studio source file declares a corner radius with a non-zero value.
3. The global stylesheet carries the `*, *::before, *::after` flatten rule.

The first two scan `studio/src` so the property is enforced for code written
later, not only for the files this change touched.

## Validation

- `npx vitest run src/test/overhaulSquareCornersAcceptance.test.tsx` — 3 passed.
- `npm run typecheck` — clean.
- `npx vitest run` — 468 passed; the 8 failures in
  `src/test/desktopShellContract.test.ts` are pre-existing (they fail on the
  unmodified tree) and concern the Ghostty bundle resource, not styling.
- `npm run build` — clean; the compiled bundle emits
  `*,*:before,*:after{border-radius:0!important}` and no non-zero radius
  survives it in Studio's own stylesheet.

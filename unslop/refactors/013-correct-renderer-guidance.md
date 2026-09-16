# CLAUDE.md contradicts the shipping renderer instructions

Status: **historical — closed by CODING-1487.** CLAUDE.md and AGENTS.md now
state one policy: embedded native libghostty on desktop development and packaged
builds, xterm over the `browserTerminalClient` WebSocket adapter for browser
development, and xterm as the compatibility fallback everywhere. The
`ghostty-wasm` renderer is gone; see
[`../../docs/archive/ghostty-wasm-restore.md`](../../docs/archive/ghostty-wasm-restore.md).
The line numbers and quoted text below describe the documents as they were when
this note was written.

Priority: P2. Effort: Small. Category: Guideline violation and hygiene.

## Evidence

- [CLAUDE.md](../../CLAUDE.md), line 15, ``ghostty-wasm` is the default terminal renderer`.
- [CLAUDE.md](../../CLAUDE.md), line 104, `Native libghostty is the default terminal renderer in desktop builds.`.
- [AGENTS.md](../../AGENTS.md), line 64, ``ghostty-wasm` is the terminal renderer`.

## Why change it

The top of CLAUDE.md names ghostty-wasm as the default. Its Runtime validation section later calls native libghostty the desktop default and ghostty-wasm a desktop diagnostic renderer. AGENTS.md says ghostty-wasm serves browser, development desktop, and packaged desktop, with native code retained only for migration. The documents explicitly require consistency. The conflicting paragraph can send development and validation work down the wrong renderer path.

## Smallest useful refactor

Rewrite the Runtime validation paragraph to match AGENTS.md and the current renderer decision. Preserve the distinction between the shipping renderer and retained migration code. Review nearby setup instructions for the same outdated assumption.

## Validation

Compare renderer statements in AGENTS.md and CLAUDE.md after editing. Documentation wording does not need a test that freezes exact prose. Existing runtime selection tests should remain the evidence for actual renderer behavior.

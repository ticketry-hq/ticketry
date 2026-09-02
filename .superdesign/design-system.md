# Ticketry conversation workspace

## Product context

Ticketry is a dense desktop workbench for planning work and running coding-agent conversations. This design target replaces the weak treatment of conversations, especially killed and ended terminal runs, with a section that makes current attention, active work, resumable runs, and history easy to scan.

The conversation section lives inside the real Stories pane. It must support task-bound, Plan, and Instant conversations; active, needs-input, resumable, terminated, and killed states; selecting a conversation; starting an Instant conversation; terminating eligible live conversations; and revealing older history without flooding the pane.

## Visual system

- Background `#0a0a0a`, panels `#111317`, borders `#2a2f3a`, title strips `#1f2530`.
- Primary text `#d6deeb`, secondary `#9aa5b8`, muted `#7a8599`.
- Blue focus `#7aa2f7`, cyan active `#7dcfff`, green success `#9ece6a`, amber attention `#e0af68`, pink danger `#f7768e`.
- Provider colors: Claude `#D97757`, Codex `#E8E8E8`, Gemini `#4285F4`, AGY `#BB9AF7`, ended `#7a8599`.
- Hanken Grotesk for readable labels and previews. JetBrains Mono for identifiers, task keys, counts, timestamps, and compact controls.
- Every corner is square. Use thin rules, aligned rows, and subtle selected fills. No gradients, glass, floating cards, oversized headings, decorative illustration, or marketing copy.
- Keep the pane dense and desktop-first. The design must work at roughly 360 to 460 pixels wide inside a larger 1440 by 900 desktop window.
- Motion is limited to 150 to 220 millisecond changes in color, opacity, and position. Respect reduced motion.

## Information priorities

1. Needs-input conversations must be impossible to miss without dominating the whole pane.
2. Active conversations should show provider identity and live state separately.
3. Resumable runs are actions. Ended and killed runs are history, not dead weight in the top row.
4. Titles and message previews matter more than internal run IDs. Task keys and conversation kind remain visible but secondary.
5. The default view should expose about 8 to 10 useful rows, then offer a clear way to reveal the rest.

## Interaction rules

- One click selects a conversation and opens its terminal in place.
- Only active or needs-input ephemeral conversations show a terminate action.
- Starting a new Instant conversation is always available.
- Never rely on color alone. Pair every status color with text, an icon, or a shape.
- Keep keyboard use visible and preserve clear focus states.
- Do not turn conversation history into closable terminal tabs. The design should reduce top-bar clutter by treating ended and killed runs as conversation history.

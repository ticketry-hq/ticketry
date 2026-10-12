---
name: lld-html-authoring
description: Author or revise a decision-complete Low-Level Design directly as a standalone HTML document. Use when the user wants the visual HTML to be the canonical LLD, asks to write an LLD in HTML without a Markdown source, or wants an interactive implementation plan centered on file changes. Do not use when LLD.md must remain authoritative; use lld-generation for that workflow.
---

# LLD HTML authoring

Create a dark-mode, implementation-ready `LLD.html` whose content and visual structure are authored together. The HTML document is the source of truth in this workflow.

## Establish authority

Read repository instructions, the ticket or specification, the approved HLD when present, relevant ADRs, current code, and existing tests. Resolve repository facts through inspection. Ask the user only about a material product or architecture decision that those sources cannot settle.

Do not create `LLD.md` unless the user separately requests it. Do not describe the HTML as generated from or subordinate to Markdown.

## Author the design

Read [references/html-authoring.md](references/html-authoring.md), then choose the output directory before writing. When Ticketry launched the skill or supplied a design directory, read [references/ticketry-storage.md](references/ticketry-storage.md) and use that directory exactly. The app-provided directory overrides every generic fallback. Otherwise, follow the repository's design-directory convention and prefer `spec/<module>/<work-item>/LLD.html` only when none exists.

Copy [assets/lld-template.html](assets/lld-template.html) into that directory as `LLD.html`, and replace the sample content with the current design.

Keep the template dark from the first paint, including on systems that prefer light mode. Preserve the inline dark tokens and `color-scheme` metadata; do not add a light fallback, theme flash, external fonts, or CDN dependencies.

The LLD must name exact files, symbols, contracts, data and state changes, failure behavior, dependencies, build order, tests, acceptance signals, and exclusions. Do not implement production code while authoring the design. Keep the document standalone and place supporting assets inside the same design directory.

Make the file-change workspace the first substantive section and the dominant page area. Put implementation and verification detail inside each file record. Treat scope, build order, diagrams, and acceptance as supporting views that clarify or summarize the file plan.

**Reuse record.** Before planning new code, fill the template's `id="reuse-record"` table. Answer the repository's three reuse questions with a cited example for each: which existing module or framework can do this (Reused), what can be configuration or generated code (Generated or configured), and what genuinely new behaviour must be implemented (New). Each row gives the behaviour, the closest example as a repository-relative path in `<code>`, and the justification. Every Reused and Generated row cites a path. A category with no behaviour keeps one row stating `none — <reason>`. Start from the [capability guide](../../../docs/feature-map/how-to-add-a-capability.md).

## Verify

**Reuse record.** Review the reuse record against the file plan and answer the three review questions for each New row and each custom file:

- Is this responsibility already owned by a framework or shared module?
- Is the custom code justified?
- Does the next similar feature become cheaper to author?

Move a behaviour to Reused or Generated when the answer to the first question is yes. A second similar implementation starts a reuse discussion, not a mandatory abstraction.

Set `data-template="false"` only after all sample content is gone. Run `scripts/check_html_lld.py <LLD.html>`, then open or render the document. Correct overflow, unreadable diagrams, broken filters, keyboard-navigation problems, and inconsistent content before finishing.

For a Ticketry-launched task, also run `scripts/check_ticketry_location.py <LLD.html>`. Report the final repository-relative path so the user can identify the document Ticketry will register.

An unresolved material decision means the HTML LLD is a draft. Label it accordingly rather than presenting it as implementation-ready.

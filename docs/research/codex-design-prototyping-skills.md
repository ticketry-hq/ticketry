# Codex design and prototyping skills

Research snapshot: 2026-08-26. Sources are limited to OpenAI, Figma, and the
official Superdesign project.

## Recommendation

Use **Figma as Ticketry's review and approval workspace**, not as a duplicate
archive of every implemented screen. Create a Figma artifact when a screen is
still being decided, needs stakeholder review, or will become a reusable design
system reference.

The most useful workflow for the main page is:

1. Use **Superdesign** or OpenAI's **Product Design** workflow to explore a few
   distinct visual directions.
2. Put the selected direction in Figma with the **Figma plugin skills**. Build
   native frames, auto layout, variables, and components rather than importing
   only a screenshot.
3. Add prototype links only for interactions that need review. Collect pinned
   comments in the prototype and resolve them as decisions are made.
4. Mark the accepted frame Ready for dev, implement it, then use a browser-based
   design QA pass against the Figma frame.

This gives the user a visual place to approve work while keeping implementation
and visual validation tied to the repository.

## What is worth using

| Capability | Best use | Approval and handoff fit | Verdict |
| --- | --- | --- | --- |
| Figma plugin skills | Native Figma screens, components, variables, motion, diagrams, Code Connect, and design-to-code | Best option here. Figma prototypes support flows, sharing, stakeholder presentation, and comments. Dev Mode carries the accepted design toward implementation. | Primary review workspace |
| OpenAI Product Design plugin | Brief to visual alternatives to interactive code, followed by design QA and sharing | Its documented flow presents three directions, waits for a selection, builds the chosen prototype, validates it in a browser, and can publish it. | Best end-to-end workflow if available |
| Superdesign | Fast UI exploration and side-by-side variants on an infinite canvas | Very good for choosing a direction. It can use codebase context and carry the chosen draft into code, but Figma has the stronger stakeholder review and handoff model. | Best visual ideation companion |
| Sites | A live, shareable web prototype | Strong for approving behavior because reviewers can use the result. It is a deployment target, not a canonical design file or formal approval record. | Use for interactive checkpoints |
| Browser plus design QA | Compare a rendered implementation with the selected visual at the same viewport and state | Provides visual evidence before handoff. It does not create or own the design decision. | Required validation companion |
| Image generation | Mood boards, visual directions, raster mockups, and individual assets | Fast for exploration, but output is flat and has no native component, token, or interaction structure. | Use upstream, not as the approval record |
| Build Web Apps frontend skill | Image-first coded UI followed by browser testing | Useful when the deliverable should immediately be working code. Less suitable than Figma when non-developers need to annotate a design before implementation. | Good implementation alternative |

OpenAI's official Product Design template documents the full `ideate` to
`image-to-code` to `design-qa` to `share` path and names Browser, Figma, image
generation, and Sites as its companion tools. It is unusually well matched to
this request because it separates visual selection from implementation.
([Product Design README](https://github.com/openai/role-specific-plugins/blob/main/plugins/product-design/README.md),
[skill catalog](https://github.com/openai/role-specific-plugins/tree/main/plugins/product-design/skills))

Superdesign's official plugin says it reads codebase context, establishes a
design system, and creates branchable drafts on an infinite canvas. That makes
it a good place to compare directions quickly. I would still move the selected
direction into Figma before asking stakeholders to approve it.
([plugin manifest](https://github.com/superdesigndev/superdesign-skill/blob/main/.codex-plugin/plugin.json),
[official repository](https://github.com/superdesigndev/superdesign-skill))

## Why Figma fits the approval goal

Figma's MCP server can read structured design context and write editable,
native Figma content back to the canvas. Its official docs list Codex as a
supported write-to-canvas client. The write tool creates frames, components,
variants, variables, and auto layout. Figma also warns that the feature is
beta-quality and may need manual review and cleanup. A Full seat and edit access
are required for writes.
([MCP overview](https://developers.figma.com/docs/figma-mcp-server/),
[write to canvas](https://developers.figma.com/docs/figma-mcp-server/write-to-canvas/))

The OpenAI Figma plugin currently publishes focused skills for creating files,
generating screens, using the Figma API, generating libraries, Code Connect,
design-to-code, diagrams, motion, SwiftUI, FigJam, and Slides. For Ticketry's
main page, the core set is `figma-create-new-file`, `figma-generate-design`,
`figma-use`, and later `figma-design-to-code`. Add `figma-generate-library` only
if the work is meant to establish reusable components or variables.
([OpenAI Figma skill catalog](https://github.com/openai/plugins/tree/main/plugins/figma/skills),
[screen-generation workflow](https://github.com/openai/plugins/blob/main/plugins/figma/skills/figma-generate-design/SKILL.md))

Figma prototypes support interactive flows, sharing, user testing, stakeholder
presentation, and view-only playback. Reviewers can pin comments to a prototype
screen, reply, mention collaborators, and resolve threads. Those comments also
appear in the underlying design file.
([prototyping guide](https://help.figma.com/hc/en-us/articles/360040314193-Guide-to-prototyping-in-Figma),
[prototype comments](https://help.figma.com/hc/en-us/articles/360039824594-Comment-on-prototypes))

Comments do not provide a general formal Approved state. For most teams, use a
named approver, a final pinned comment such as `Approved for implementation`,
resolve the remaining threads, and mark the frame Ready for dev. Organization
and Enterprise plans have a stricter option: branches can be submitted for
review, approved, and merged.
([Dev Mode guide](https://help.figma.com/hc/en-us/articles/15023124644247-Guide-to-Dev-Mode),
[Figma branching](https://help.figma.com/hc/en-us/articles/360063144053-Guide-to-branching))

## Discovery sources

The public Plugin Directory is the normal place to look for current Codex
plugins. OpenAI also publishes its first-party plugin source and role-specific
workflow templates on GitHub. Figma maintains its own community-resources
repository for open-source plugins, widgets, agent skills, and developer
resources. Third-party entries still need a provenance, permission, and data
access review before installation.
([OpenAI plugin documentation](https://learn.chatgpt.com/docs/plugins),
[OpenAI plugins repository](https://github.com/openai/plugins),
[OpenAI role-specific plugins](https://github.com/openai/role-specific-plugins),
[Figma community resources](https://github.com/figma/community-resources))

## Practical choice for Ticketry

Start with the Figma skills already available in Codex. Use Superdesign only to
generate competing visual directions before committing one to Figma. Use the
browser and design QA after implementation. Add Sites only when reviewers need
a live, clickable build rather than a canvas prototype.

For a single main page, this is enough. Building a full design system or adding
Code Connect now would be more work than the decision requires unless the page
will establish Ticketry's reusable visual language.

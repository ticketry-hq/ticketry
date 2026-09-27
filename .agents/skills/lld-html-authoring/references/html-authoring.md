# Authoring a canonical HTML LLD

The HTML document owns both the implementation plan and its presentation. It must remain understandable without a companion Markdown file.

## Required design content

Cover the design basis, exact scope, preserved behavior, repository findings, preflight gates, file and component changes, observable contracts, data and state changes, runtime and failure flows, implementation order, verification, acceptance, and explicit exclusions.

The implementation agent should not need to invent a product, behavior, architecture, migration, or interoperability decision. Leave ordinary local syntax and refactoring choices to implementation.

## File-change view

Use the template's file-change workspace as the main navigation surface. Populate `LLD_DOCUMENT.files` with one record for every changed file and any intentionally untouched boundary file that prevents scope creep.

Place this workspace immediately after the compact header and navigation, and give it most of the initial working viewport. A reviewer should reach the actionable plan before any long-form context or diagram.

Each record should include:

- stable ID, verified path, action, and architectural layer;
- a plain description of why the file changes;
- exact existing or proposed symbols;
- responsibilities after the change;
- non-responsibilities and behavior that stays unchanged;
- exact implementation work for that file;
- file-level verification signals;
- dependency position, tests, and decision or acceptance IDs.

The inspector explains planned responsibility rather than pretending to show a source diff. It should contain enough detail to implement and verify the selected file without searching through the rest of the document. Preserve search, action filters, directory grouping, deep links, and keyboard navigation.

## Visual composition

Keep the file-change view as the signature interaction. Add component, sequence, state, contract, risk, or trace views only when they make a real relationship easier to understand. Remove unused template sections and decorative visuals.

The template uses a dark drafting-sheet palette. Keep the page, navigation, file rail, inspector, inputs, badges, code, and any diagrams dark. Set dark colors inline before body content so the document stays dark before JavaScript runs, even when the operating system prefers light mode. Preserve contrast, hierarchy, responsive behavior, and interaction semantics when adapting it.

Keep the chrome dense. The header stays one compact band with inline counts, the rail lists one file per line, and the file workspace fills the first viewport at desktop width. Do not reintroduce display-size headings, count tiles, or explanatory ledes above the workspace.

## Completion gate

- Every acceptance signal traces to planned files and verification.
- Every file record states both responsibility and boundary.
- Failure, migration, compatibility, and rollout behavior are covered when relevant.
- No sample paths, example decisions, placeholder prose, or inactive controls remain.
- The footer states that this HTML document is authoritative.
- Desktop and narrow layouts are visually checked.

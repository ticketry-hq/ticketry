# Ticketry design-document storage

Ticketry discovers design documents from an authorized design directory. Placement is part of the integration contract, not an editorial choice.

## Prefer launch context

When the launch prompt names a `Design directory`, write there exactly. When it says the working directory is the document's design directory, keep every generated LLD file in the current directory. Do not create another `spec` tree, rename the directory, or reconstruct a cleaner path.

An existing directory wins over a newly computed name because Ticketry resolves stable identity suffixes and deliberately reuses directories after module or task renames.

## Canonical shapes

Relative to the module's configured local folder:

- task: `spec/<module-slug>--<module-id8>/T<sequence>--<task-slug>/`
- task without a sequence: `spec/<module-slug>--<module-id8>/<task-id8>--<task-slug>/`
- planning or instant run: `spec/<module-slug>--<module-id8>/planning/<run-id8>/`

The eight-character identity suffixes are authoritative. The readable slugs are cosmetic. Never guess an ID suffix from a title or repository name.

For a task-bound LLD, place `LLD.md` and `LLD.html` as siblings at the root of the task design directory. For direct HTML authoring, place `LLD.html` there. Ticketry scans Markdown and HTML recursively and registers new or changed files, but root-level standard names keep the task workspace predictable.

## Scratch promotion

Keep planning output in the app-provided `planning/<run-id8>/` directory while no task exists. If the launch instruction creates a Work Item and explicitly asks for promotion, move the whole design-directory contents to the task's resolved canonical directory. Do not copy only one half of an LLD pair.

## Verification

Run the skill's `scripts/check_ticketry_location.py` against every generated LLD artifact. A failure means the path is outside Ticketry's canonical task or planning layout; fix the output location before reporting completion.

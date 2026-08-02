# Archiving is a flag, not a workflow state

Archiving a work item — including a module — writes the existing
`Issue.is_archived` boolean directly and cascades it over the descendant
subtree; it does not move the item through a workflow. We considered giving the
`Module` issue type a real workflow so a container could be marked Done or
Cancelled like anything else, and rejected it: modules are deliberately
stateless (`create_module` never sets `state`, and the module type is
model-owned rather than declared in the reviewed-defaults artifact), so a
workflow would have forced a visible state axis onto `ModuleOut`, the module
panes, and the workflow editor to express one boolean. It would also have
bound module archival to the shared project state catalog, whose states users
can rename and re-group at will.

## Consequences

`is_archived` now has two writers rather than one — the cancellation cascade
and this direct act — so the field no longer implies "this work was cancelled",
and nothing records which of the two archived a given row. That is why
archiving is one-way for now: a faithful restore needs to know what it is
undoing, and that bookkeeping is deferred to the story that introduces the
archived-items view.

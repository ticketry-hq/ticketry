---
status: accepted
---

# The module base checkout opens in the module's own workspace

[ADR 0012](0012-source-control-review-uses-a-changes-workspace-tab.md) chose a
pinned Changes tab for reviewing a task worktree and left one question open:
how a module-scoped checkout reaches the same review. CODING-981 answers it.

The module base checkout is reviewed in the module's own workspace — the
per-module scratch workspace Studio already keys as
`scratchBucketId(moduleId)` — through the same pinned Changes tab, the same
`ChangesPanel`, and the same diff viewer. Which checkout a panel reviews is
carried by an explicit `CheckoutRef`, so the surface is shared while the
identity never is.

## Considered options

Re-opening the rejected module-scoped bottom Git panel would have reintroduced
exactly the competition with the terminal panel that ADR 0012 ruled out. A new
module-only review surface reached from the Modules pane or a module tab's
menu would have added a second panel model for one payload, against the
ticket's "reuse the same diff viewer and interaction model" constraint. The
module's scratch workspace was chosen because it is already the only
module-scoped workspace in Studio: its Details tab shows the module's
lifecycle aggregate, and its terminals already launch in the module folder —
the very checkout being reviewed.

## Consequences

`hasChanges` is no longer "not a scratch workspace"; it is "this workspace
resolves a checkout". A scratch workspace with no selected module still has no
Changes tab. Workspace tab order stays unpersisted for scratch workspaces, so
the module's Changes tab keeps its default position.

Both checkout kinds share one response contract, discriminated by `checkout`
(`worktree` | `module`) with only that kind's identifiers populated, and one
absence discriminant per kind (`no_worktree` | `no_checkout`). Query keys carry
the checkout kind, so invalidating a task worktree cannot repaint a module
review or vice versa. The base checkout has no base branch: the panel presents
the branch it is on and compares it with nothing.

The terminal action for a module base checkout was still open when this was
written. CODING-985 settled it as the expected `Commit & push` sync flow, with
the pull-request stack kept one press away in the action menu; see
[ADR 0014](0014-the-module-base-checkout-ships-with-commit-and-push.md).

---
status: accepted
---

# The module base checkout ships with commit & push

[ADR 0013](0013-the-module-base-checkout-opens-in-the-modules-own-workspace.md)
put the module base checkout's review in the module's own workspace and left
one question open: which action that review ends in. CODING-985 answers it.

The module checkout's primary action is **Commit & push**. Every action the
worktree footer offers is offered here too — the pull-request stack and the
commit-only action sit in the same overflow menu — but the *default* differs,
because the two checkouts normally sit in different places. A task worktree is
on a branch cut for review, so the pull request is the point of the work. A
module base checkout is normally on the repository's default branch, where the
pull request's own precondition refuses the action; leading with a button that
always fails there would be a worse default than leading with the sync flow.

## Considered options

Full parity — the pull-request stack primary in both panels — was rejected for
exactly that reason: the primary action would be the one action a base checkout
usually cannot run. Withholding the pull request from the module surface
altogether was rejected too, because a base checkout parked on a feature branch
is an ordinary state, and refusing it there would mean a second interaction
model for the same payload, against the constraint ADR 0012 set. So the actions
are the same set and only their ordering is per-kind, expressed as one table in
`features/source-control/internal/actionPlans.ts`.

## Consequences

The write surface is now checkout-generic all the way down. `CheckoutRef`
carries which checkout every command, cache key, and confirmation is about, so
one footer, one confirmation, one step list, and one set of mutations serve both
kinds; the two never share a cache entry or a command. On the backend the
commit, push, and pull-request actions take either resolved checkout, and each
kind keeps its own route and request shape so which checkout is written is fixed
by the route rather than by a mode flag. The per-checkout lock is keyed by path,
so a module action and a task-worktree action in the same repository serialize
independently.

Only one thing is genuinely absent on a module base checkout: a recorded base
branch. It resolves to the empty string, which the push and pull-request
preconditions already read as "resolve the base from the repository", so a
module pull request targets the repository's own default branch.

Result sentences name the checkout they are about — "safe in this checkout"
rather than "safe in this worktree" — from one noun per kind rather than two
copies of every message.

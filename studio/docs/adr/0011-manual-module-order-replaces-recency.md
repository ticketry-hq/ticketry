# A project's manual module order replaces recency ordering

Modules were ordered newest-agent-activity-first on every Studio surface, with
inactive modules trailing in API order. We decided a project acquires one
shared, project-wide manual module order on its first module drag (seeded from
the order visible at that moment), and from then on that order is the canonical
order everywhere — agent activity never reshuffles it, and there is no reset
back to automatic ordering in v1. Newly created modules always enter at the
front of the order, in both modes.

## Considered Options

- **Manual base with a recency boost** (active modules float up) — rejected:
  modules moving on their own defeats the point of manual ordering.
- **Per-user order** — rejected: the canonical order must be a shared fact so
  pickers, backlog grouping, and keyboard position shortcuts mean the same
  thing to everyone.
- **Per-surface ordering** — rejected: one shared cached order feeds every
  surface today, and splitting them reintroduces drift.

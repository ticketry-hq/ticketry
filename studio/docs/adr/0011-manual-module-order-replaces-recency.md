# A project has one canonical module order

An automatic project lists modules in creation order. A project acquires one
shared, project-wide manual module order on its first module drag, seeded from
the order visible at that moment. That order then becomes canonical everywhere.
Agent activity never reshuffles modules, and there is no reset to automatic
ordering in v1. Newly created modules always enter at the end in both modes.

## Considered Options

- **Manual base with a recency boost** (active modules float up) was rejected:
  modules moving on their own defeats the point of manual ordering.
- **Per-user order** was rejected. The canonical order must be a shared fact so
  pickers, backlog grouping, and keyboard position shortcuts mean the same
  thing to everyone.
- **Per-surface ordering** was rejected. One shared cached order feeds every
  surface today, and splitting them reintroduces drift.

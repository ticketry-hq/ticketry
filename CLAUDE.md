# Agent guidance — unified Studio application

**Read this before changing anything in this repository.** The repository
contains the complete Studio application: its Django backend and `worktracker`
app at `backend/`, API surfaces, and one frontend. The canonical frontend entry is
`studio/index.html` → `studio/src/main.tsx`; its Vite development server listens
on `127.0.0.1:5174`. Work-item planning, agent lifecycle, terminals,
worktrees, documents, prompts, modals, and launch flows belong to this
application.

Use the application’s canonical runtime scripts. `scripts/dev.sh studio` starts
the browser frontend; `npm run desktop:dev` and `pnpm dev` rebuild the sidecar
and launch the desktop application.

## Code structure — governing rules

The file tree is the primary map of this project. Someone should be able to
understand what the app does by reading folder and file names alone, before
opening any code. To keep that true:

- **Small, focused files.** One concern per module. When a file grows past
  roughly 300–400 lines, split it by concern instead of adding to it. Never
  bolt a new responsibility onto an existing file because it is convenient.
- **Frontend layout** (`studio/src/`): `app/` holds the shell (navigation,
  modals, onboarding, startup, styles); `features/<domain>/` holds one folder
  per domain with its own `api`/`queries`/`mutations`/`selectors`/`internal`
  split; `shared/` holds cross-feature plumbing only; `runtime/` holds the
  browser-vs-desktop contract and implementations; `state/` stays minimal.
  New UI code goes in the feature folder it belongs to — create a new
  `features/<domain>/` folder rather than growing `shared/` or `app/`.
- **Backend layout** (`backend/`): `worktracker/` is the core domain, split
  into `models/`, `rest/`, `services/`, `tests/` plus small single-purpose
  modules; each surrounding capability is its own Django app under `apps/`.
  New capabilities get a new app; new domain logic gets a new focused module.
- **Name by purpose.** File and folder names must say what the code does
  (`ranking.py`, `desktopRuntime.ts`), not generic buckets (`utils2.ts`,
  `helpers.py`, `misc/`).
- **Refactor opportunistically.** When touching an oversized file (e.g.
  `SelectedTicketContent.tsx`, `rest_api.py`), prefer extracting the piece
  you're changing into its own module over enlarging the file.

## Database-backed GraphQL Models — governing rules

Ticketry's Rust GraphQL surface is migration-first and generated-contract-first:

- **Begin with generated CRUD.** Seaography-generated model CRUD, filters,
  ordering, pagination, inputs, and outputs are the default capability. Author
  caller-specific `.graphql` operations and review the generated SDL as public
  API. Never patch generated entities, SDL, or bindings by hand.
- **Restrict writes at the public boundary.** An identity-scoped update or
  delete binds a non-null identity into its filter. Its input allowlists only
  caller-writable fields and preserves `omitted | null | value`; it never
  exposes project ownership, derived module ancestry, ranks, revisions,
  timestamps, counters, or other protected fields.
- **Use one model-shaped write seam.** If a raw generated mutator would bypass
  Ticketry invariants, keep it private and expose one restricted authored
  create/update/delete operation for that Model. The operation remains CRUD;
  it delegates to internal model operations for validation, locking, revision
  allocation, derived-field repair, pruning, cascades, and event planning.
- **Do not turn helpers into APIs.** WorkItem parent, blockers,
  classification, archive, and state are fields or relationships on the one
  WorkItem update contract. Reparenting, blocker-cycle validation, transitions,
  and archive cascades may require focused internal modules, but do not justify
  separate public mutations. A state transition supplied through WorkItem
  update remains an exclusive patch and cannot be mixed with unrelated fields.
- **Quarantine genuine exceptions.** Only behavior that cannot be expressed as
  model CRUD may be a named domain operation. Record every exception and its
  reason in the route/operation registry; keep that registry exactly equal to
  the live GraphQL mutation surface. The current exceptions are work-item
  reorder, state reorder, issue-type reorder, remove-state-from-workflow, and
  onboarding acknowledgement.
- **Require evidence for deviations.** Stop before adding replacement CRUD,
  per-field/per-relationship RPCs, a DAO or repository that mirrors SeaORM,
  mirrored DTOs, `mutation: false`, or generated-file patches. Record the exact
  missing behavior, why database/framework facilities cannot provide it, the
  smallest custom seam, and a test preventing the deviation from spreading.
- **Converge client state deliberately.** Updates return the authoritative
  changed entity. When membership or ordering can change, update or refetch all
  affected lists; creates update/refetch lists and deletes evict known
  identities or explicitly refetch.

## Reference

| Doc | Purpose |
| --- | --- |
| [`README.md`](README.md) | Application layout and install/run/validate commands. |

## Runtime validation

Install from the repository root, then run:

```bash
npm run typecheck
npm run test --workspace @worktracker/studio
npm run build --workspace @worktracker/studio
```

Keep the runtime facts here and in [`AGENTS.md`](AGENTS.md) consistent.

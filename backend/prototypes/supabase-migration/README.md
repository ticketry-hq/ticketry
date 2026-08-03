# Ticketry → Supabase migration prototype

> **PROTOTYPE — delete or absorb after the architecture decision.**

## Question

Can Supabase become Ticketry's shared durable data plane without moving
machine-local execution—tmux, native terminal rendering, worktrees, filesystem
watching, and the supervised MCP/backend lifecycle—out of the desktop sidecar?

Run the interactive boundary model from the repository root:

```bash
npm run prototype:supabase
```

Try these sequences:

1. Press `c`, then compare the Studio projection and Supabase row.
2. Press `o`, `c`, and `s` to see the explicit online/offline contract.
3. Press `l`, `o`, and `l` to see which part of an agent run is shared and
   which part remains local.
4. Press `r`, then `d` to see why pointing the React client directly at every
   table would bypass Ticketry's workflow policy.

## Recommended target

The first migration should be a database substitution behind the existing API,
not a backend rewrite:

```text
React / Tauri webview
  ├─ Supabase Auth session (phase 2)
  ├─ Supabase Realtime for shared row changes (phase 3)
  └─ Django HTTP + local WebSockets
       ├─ Supabase Postgres: shared work and durable run ledger
       ├─ Supabase Storage: attachments (phase 4)
       └─ local runtime: tmux, worktrees, docs, settings, terminal bytes
```

Why retain Django? Ticketry already has atomic sequence allocation, row locks,
workflow transition rules, archive cascades, blocker-cycle checks, launch
policy, post-commit automation, an OpenAPI contract, and MCP callers. Swapping
the ORM connection to Postgres reuses those rules. Direct browser writes would
require the same policy to be rewritten as Postgres functions/triggers before
they are safe.

## Ownership split

| Supabase/shared | Sidecar/local |
| --- | --- |
| workspaces, projects, states, issue types | tmux sessions and terminal bytes |
| work items, parent/blocker edges, ranks | worktree paths and live git state |
| workflow transitions and launch bindings | filesystem discovery/watch state |
| shared agent-run lifecycle and automation attempts | provider session handles and host-local paths |
| attachment metadata and objects | personal settings and viewer leases |

`DesignDocument` needs a product decision: keep only its local discovery index,
or promote documents to shared objects/git artifacts. Do not upload arbitrary
workspace files as an incidental database migration.

## Migration slices

1. **Postgres portability.** Add `psycopg`, configure `DATABASE_URL`, run the
   Django suite against a local Supabase Postgres, and remove SQLite-only test
   assumptions from production paths. Keep SQLite only as an explicit local
   fallback during the spike.
2. **Fresh-schema data rehearsal.** Apply Django migrations to a blank Supabase
   database, export/import one isolated development profile, verify counts,
   foreign keys, UUIDs, sequence counters, attachments, and state revisions.
3. **Cloud database behind Django.** Ship a feature flag that changes only the
   Django database connection. No React data-client rewrite yet.
4. **Identity and tenancy.** Introduce users/workspace memberships, Supabase
   Auth, JWT verification in Django, and RLS. The current static API key and
   single-workspace model are not enough for a hosted multi-user database.
5. **Realtime and Storage.** Replace the shared work-item portion of `/ws/status`
   with Realtime after cursor/reconnect behavior is proven; keep terminal and
   local-run frames on Django Channels. Move attachments to a private Storage
   bucket with workspace policies.
6. **Optional direct reads/RPCs.** Only after policies exist, consider direct
   reads from React. Keep complex mutations in Django or move them atomically to
   reviewed Postgres RPCs—never duplicate policy in two writers.

Supabase's local stack requires a Docker-compatible runtime. Its documented
workflow commits `supabase/config.toml`, SQL migrations, and seed data, while
generated local data remains uncommitted. That fits this repository's data
isolation rule, but it makes desktop development heavier than today's embedded
SQLite path.

## Primary references

- [Connect to Supabase Postgres](https://supabase.com/docs/guides/database/connecting-to-postgres)
- [Local development and CLI](https://supabase.com/docs/guides/local-development)
- [Row Level Security](https://supabase.com/docs/guides/database/postgres/row-level-security)
- [Realtime Postgres Changes](https://supabase.com/docs/guides/realtime/postgres-changes)
- [Auth architecture](https://supabase.com/docs/guides/auth/architecture)
- [Storage access control](https://supabase.com/docs/guides/storage/security/access-control)


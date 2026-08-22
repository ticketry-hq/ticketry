---
name: seaography-graphql-audit
description: Audit a Rust GraphQL codebase for deviations from Ticketry's Seaography-first, SeaORM-backed model contract. Use when asked whether a codebase, branch, feature, query, or mutation is over-customized, bypasses generated Seaography behavior, uses direct database access, or needs a framework-convergence plan.
---

# Seaography GraphQL compliance audit

Audit first; do not change application code unless the user also asks for a
fix. The audit answers two questions:

1. Where did the code bypass generated Seaography or SeaORM without proving it
   was necessary?
2. In what order should those deviations be moved back to the framework?

## Load the governing rubric

Before inspecting code:

1. Read `../../../AGENTS.md` and the database-backed GraphQL section of
   `../../../CLAUDE.md`.
2. Read the complete sibling skill at `../seaography-graphql/SKILL.md`, including
   every reference it requires.
3. Confirm the pinned Seaography and SeaORM versions. Treat hook and mutation
   behavior as version-specific.

The sibling `seaography-graphql` skill is the implementation authority. This
skill finds and prioritizes drift; it must not invent a competing architecture.

## Establish the intended model graph

Inventory these before judging any resolver:

- database migrations and tables;
- SeaORM entities, columns, primary keys, and relations;
- Seaography entity registrations, whether each uses `mutation: false`, and
  any `GeneratedMutations` selection installed by Ticketry's registrar;
- the schema builder's database connection;
- `BuilderContext` type codecs, input skips, guards, filters, and hooks;
- generated GraphQL SDL;
- caller-owned `.graphql` documents and generated bindings;
- custom query/mutation registrations and custom output/input types;
- the route/operation exception registry and its conformance tests.

Use `rg` and the generated SDL as the first-pass inventory. Useful searches:

```bash
rg -n "register_entity!|mutation: false|GeneratedMutations|register_generated_mutations|register_custom_(query|mutation)" studio/src-tauri/src
rg -n "CustomFields|CustomOutputType|CustomInputType" studio/src-tauri/src
rg -n "insert_skips|update_skips|entity_guard|field_guard|entity_filter|entity_watch|before_active_model_save" studio/src-tauri/src
rg -n "rusqlite|sqlx::|from_sql|from_string" studio/src-tauri/src
rg --files studio/src | rg '\.graphql$|generated/schema\.graphql$'
```

Search results are leads, not findings. Trace each public GraphQL field through
its resolver/domain service to persistence before classifying it.

## Check for deviations

### Schema and entity composition

Flag:

- a database table exposed through handwritten GraphQL without a registered
  SeaORM entity;
- generated entities using a builder connection for the wrong database;
- patched generated entities, SDL, or bindings;
- migration/entity/schema drift hidden by custom projection code.

### Reads

Flag ordinary entity reads that reimplement generated:

- list/detail lookup, filtering, ordering, or pagination;
- relationship loading already expressible through generated relations;
- DataLoader behavior;
- model fields through mirrored `CustomOutputType` structs;
- pass-through read repositories;
- renaming, flattened IDs, or presentation shaping that belongs in GraphQL
  aliases and caller adapters;
- one-column formatting that belongs in `ColumnOptions`.

Do not flag a focused aggregate or computed projection merely because it is
custom. Require evidence that generated columns, relations, filters, `having`,
aliases, codecs, and caller adaptation cannot represent it.

### Mutations

For every registered entity, audit create-one, create-batch, update, and delete
together, then compare the result with Ticketry's per-operation selection.
Flag:

- any generated operation selected without a four-operation safety audit;
- `mutation: false` with neither a `GeneratedMutations` selection nor a written
  invariant/override record;
- a selected operation absent from the audit, or an audited-private operation
  present in the SDL;
- duplicated entity mutation registration or multiple helper calls that can
  register the same support type twice;
- custom flat CRUD that skips, guards, filters, constraints, or hooks could
  safely express;
- unrestricted inputs exposing ownership, ranks, revisions, timestamps,
  counters, derived fields, or protected foreign keys;
- updates/deletes without a concrete identity and mandatory row scope;
- patches that collapse `omitted | null | value`;
- model fields or relationships exposed as separate public RPCs;
- update/create seams that do not return the authoritative model;
- named domain operations absent from the exception registry.

Do not recommend a generated operation just because its persistence is simple.
Use Ticketry's registrar to keep each unsafe or unused operation private.
Generated update/delete remain filter-based and are normally unsuitable where
a non-null identity is required.

### Hooks and invariant placement

Flag:

- generated update relying on `before_active_model_save` or SeaORM
  `before_save`; rc.9 does not run them;
- generated delete relying on SeaORM `before_delete`/`after_delete`; rc.9 does
  not run them;
- create scoping placed in `entity_filter`, which does not apply to insert;
- validation or durable effects placed in `entity_watch`;
- `MultiLifecycleHooks` expected to forward `before_active_model_save` in
  rc.9;
- GraphQL-only hooks enforcing invariants that must also hold for MCP, native,
  background, or test writers;
- transaction-required cross-row behavior placed in a non-transactional
  create-one hook.

### Persistence boundaries

Flag:

- `rusqlite`, SQLx, or raw SQL implementing ordinary model CRUD;
- a DAO/repository that merely mirrors SeaORM;
- custom resolvers containing validation, locking, cascade, or repair logic
  instead of delegating to a focused domain module;
- `update_many`/`delete_many` used while assuming ActiveModel lifecycle hooks
  will run;
- multi-row changes performed without a SeaORM transaction.

Do not flag raw SQL in migrations, schema introspection, or a documented
database-specific atomic primitive that SeaORM cannot express.

### Contract and drift protection

Flag:

- clients using ad-hoc query strings instead of owned `.graphql` operations;
- handwritten generated bindings;
- missing SDL/operation drift checks;
- missing authorization, row-scope, rollback, codec, relation, or hook tests at
  the boundary that makes an override safe;
- user-visible Studio behavior without an acceptance case.

## Classify each surface

Use exactly one classification:

- **Generated/conformant** — uses generated Seaography and the correct
  framework/database seams.
- **Justified override** — missing framework capability is recorded, the seam
  is minimal and model-shaped, it uses SeaORM, and a drift test exists.
- **Deviation** — custom/direct behavior duplicates a framework capability or
  lacks the required evidence.
- **Needs proof** — source suggests an exception, but invariants or tests are
  insufficient to decide safely.

Rank findings:

- **P0:** wrong database, public protected fields, missing identity/scope,
  invariant bypass, or unsafe generated write.
- **P1:** replacement CRUD/read, direct model SQL, mirrored DTO/repository,
  undocumented `mutation: false`, or per-field RPC drift.
- **P2:** caller-shaping duplication, codec duplication, missing drift test, or
  cleanup that does not currently threaten correctness.

## Report concisely

Lead with one verdict: `aligned`, `mostly aligned`, or `drifted`.

Then report:

```text
Entities registered: <n>
Entities with mutation:false: <n>
Custom query fields: <n>
Custom mutation fields: <n>
Custom model output mirrors: <n>
Ordinary CRUD paths bypassing SeaORM: <n>
Documented justified overrides: <n>
Unjustified/needs-proof overrides: <n>
```

List findings with exact file and line evidence:

| Priority | Surface | Why it deviates | Framework replacement | Blocker |
| --- | --- | --- | --- | --- |

Finally give a least-complex-to-most-complex convergence queue. Prefer:

1. caller aliases/adapters and one-column codecs;
2. generated reads and relations;
3. mirrored output/pass-through layer deletion;
4. flat generated mutation operations whose individual selections are safe;
5. restricted model-shaped mutations using SeaORM transactions;
6. invariant-heavy graph/workflow operations last.

Do not dump every search hit. Group repeated patterns and name the exact
surfaces affected.

## Remediation handoff

When the user asks to fix findings, explicitly switch to the sibling
`seaography-graphql` skill. Remediate one coherent batch at a time:

1. read its full instructions again;
2. start from the migration/entity/registration/caller operation;
3. complete the four-write audit before selecting any generated mutation;
4. create an override record for every custom seam that remains;
5. run the skill's required focused, drift, typecheck, and acceptance tests;
6. report the reduced custom counts and blockers that remain.

Never turn an audit finding directly into generated CRUD without performing
that safety workflow.

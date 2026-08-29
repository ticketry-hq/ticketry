# Final-main overlap with the 602596a parity work

Research snapshot: 2026-08-27. This audit uses Git objects and files in the
current dirty `work/rust-main-parity` worktree. It does not inspect or modify
Ticketry. Concurrent product changes in the worktree are treated as in-progress
evidence and are not edited here.

## Direct recommendation

Keep `CODING-1155` and its implementation hierarchy in place. No commit after
`44a3c6e1` supersedes, contradicts, or makes any 602596a parity slice irrelevant.
The final `origin/main` snapshot adds two corrections that must be folded into
the existing implementation guidance and one downstream release-test update:

1. The `ModulePresentation` data migration must run every read and write through
   the migration's active database connection. This belongs in `CODING-1164`.
2. The `gpt-5.3-codex-spark` work must cover an idempotent upgrade of an existing
   provider catalog, not only fresh-install provisioning. Its migration test
   must create Codex before crossing the earlier catalog migrations. This
   belongs in `CODING-1161`.
3. The final installed-artifact gate must create valid module and task fixtures
   for the final schema and stop treating Workspace as the readiness record once
   the earlier 0046 Workspace-removal work has landed. This belongs in the final
   integration work under `CODING-1159`, after the schema dependencies.

The current dirty worktree has started the 0049 workspace-tab field and fresh
Codex Spark provisioning. It has not finished the Codex Spark upgrade path, the
0050 presentation model, or the frontend behavior. Do not mark the parent Story
complete based on the present changes.

## Target snapshot and ancestry

The requested target is the exact `origin/main` tip:

```text
78201ef0005cca46ea798c78553fb37b54fc09c0
Merge pull request #48 from ticketry-hq/release/0.2.0
```

Git places these commits after the reviewed 602596a content and its first merge:

```text
602596a1 Harden terminal runtime ownership and agent launch isolation
44a3c6e1 Merge pull request #28
9d752d77 Prepare Ticketry 0.2.0 release
24c28f1e Fix release acceptance for current schema
041b78c4 Merge pull request #47
e8239636 Add release download and product screenshots
78201ef0 Merge pull request #48
```

The whole-tree delta from `602596a1` to `78201ef0` is 26 paths, 183 insertions,
and 74 deletions. Only two paths were changed both by 602596a and by a later
commit:

```text
backend/worktracker/migrations/0050_module_presentation.py
backend/worktracker/tests/test_migration_codex_5_3_model_catalog.py
```

That intersection is decisive. Later main does not rewrite the workspace-tab
UI, module hiding and restoration, jump badges, sidebar recovery, required-skill
prompting, native body disengagement, runtime ownership, or MCP policy delivered
or specified by 602596a.

## Merge checks against both parents

### 041b78c4

`041b78c4` has first parent `44a3c6e1` and second parent `24c28f1e`.

```text
merge tree:         8b4855fbec627c83503d34fa3c892f6a49e5b197
first-parent tree:  315ed85df62b61aa8381eb90ec063bcc266cbd3e
second-parent tree: 8b4855fbec627c83503d34fa3c892f6a49e5b197
merge base:         44a3c6e1aa78da7af765e8fa436e683335cff2ce
```

The first parent is an ancestor of the second parent. The recorded merge tree
equals the second-parent tree, the second-parent diff is empty, and the combined
diff is empty. The 23-path first-parent diff is exactly the already-audited
`9d752d77` plus `24c28f1e` content. The merge adds no resolution or behavior.

### 78201ef0

`78201ef0` has first parent `041b78c4` and second parent `e8239636`.

```text
merge tree:         b145498623b9752bbb4df992f4551c1f9ae55f0d
first-parent tree:  8b4855fbec627c83503d34fa3c892f6a49e5b197
second-parent tree: b145498623b9752bbb4df992f4551c1f9ae55f0d
merge base:         24c28f1e299ab15f7b1c9068c5f4efb45d6c4683
```

The first-parent tree equals the merge-base tree. The recorded merge tree
equals the second-parent tree, the second-parent diff is empty, and the combined
diff is empty. Its four-path first-parent diff is exactly `e8239636`. This merge
also adds no resolution or behavior.

## Verdict by commit

| Commit | Direct verdict for CODING-1155 | Evidence and action |
| --- | --- | --- |
| `9d752d77` | Depends on and refines two slices. It does not override them. | It fixes migration 0050 to use `schema_editor.connection.alias` for all queries and writes. Carry that rule into `CODING-1164`. It fixes the 0051 test to create Codex at migration 0043 before migrating through 0050. Carry the equivalent upgrade fixture into `CODING-1161`. The migration behavior itself is unchanged. |
| `24c28f1e` | Downstream follow-up for the final integration gate. | It changes installed-artifact readiness from `worktracker_workspace` to `worktracker_project`, creates valid module and task rows when a fresh project has none, includes `workspace_tab_order='[]'`, and inserts terminal rows with the current cleanup and output columns. Adapt this to Rust under `CODING-1159` after the schema work. |
| `041b78c4` | Unrelated topology. | Its tree exactly equals second parent `24c28f1e`; there is no independent merge content. |
| `e8239636` | Release-only documentation. | It adds a 0.2.0 download badge, minimum-platform text, three screenshots, and README image links. It changes no application behavior and does not affect CODING-1155. |
| `78201ef0` | Unrelated topology and final snapshot marker. | Its tree exactly equals second parent `e8239636`; there is no independent merge content. |

## Final-snapshot classification

### Required parity within CODING-1155

The final snapshot retains every 602596a product requirement. None is reverted.
The required implementation set remains:

- validated, durable workspace-tab order and its GraphQL and Apollo flow;
- tab drag, restoration, dormant identity handling, and terminal cycling;
- `ModulePresentation` as the typed owner of module rank and `tab_hidden`;
- hidden-tab selection, restoration, picker, sidebar recovery, visible-only
  shortcuts, jump badges, and sidebar lifecycle state;
- provider-qualified required-skill references;
- `gpt-5.3-codex-spark` with no permitted reasoning rows and null reasoning;
- native `Cmd+Escape` body disengagement;
- runtime ownership and MCP termination verification;
- wording consistent with Rust's fail-closed MCP launch policy.

The later commits add these details:

- `CODING-1164` must make the 0050-equivalent migration connection-local and
  transactional. A test must run the migration through the supplied connection
  and prove it does not read or write another configured database.
- `CODING-1161` must preserve an existing Codex provider and existing model rows,
  insert Spark once, and leave Spark with zero reasoning associations. The
  current dirty implementation proves only a newly provisioned database.

### Downstream follow-up

`24c28f1e` is not a new feature requirement. It repairs the release acceptance
driver after schema changes that precede and include 602596a.

The Rust driver currently still checks `worktracker_workspace` for readiness and
snapshot recovery. It also has a compatibility path that creates a project from
a Workspace when no project exists. Those checks remain coherent while the Rust
schema still owns Workspace. After the earlier 0046 removal lands, the final
driver must use Project as the readiness record and remove the fallback.

The current Rust driver already inserts `runtime_cleanup_pending` and
`output_sequence`, so that part of the later main fix is present. Its raw issue
fixture omits `workspace_tab_order`; the in-progress 0049 migration supplies the
`[]` default, but the final integration test should still create rows against
the final schema explicitly and prove fresh-project behavior. This belongs in
`CODING-1159`, not in a replacement Story.

The root `package.json` is still `0.1.0`, while the Studio package, Tauri config,
and Rust crate are already `0.2.0`. Aligning the root version and release
manifest is release follow-up outside the 602596a product scope.

### Already present or in progress in the dirty Rust worktree

The dirty worktree contains active implementation work. The relevant evidence
is:

- `studio/src-tauri/src/entities/work_management/issue.rs` now has
  `workspace_tab_order`.
- `studio/src-tauri/src/work_management/workspace_tab_order_migration.rs` adds
  the JSON-array column transactionally with an owned ledger and validates
  repeat runs.
- `studio/src-tauri/src/work_management/workspace_tab_order.rs` validates tab
  identities, rejects cross-work-item ownership, and prunes missing identities.
- `studio/src-tauri/src/work_management/graphql/work_items.rs` routes the field
  through the restricted WorkItem update.
- `studio/src-tauri/src/settings_persistence/provider_catalog_provisioning.rs`
  adds `gpt-5.3-codex-spark` with an empty reasoning set for fresh installs.
- `studio/src-tauri/tests/installation_adoption.rs` checks fresh provisioning
  and zero Spark reasoning rows.

This is partial progress, not completion. There is no existing-install Spark
migration. The frontend workspace ordering feature is absent. The current tree
still stores `manual_module_order` on Project and has no `ModulePresentation` or
`tab_hidden`. It also lacks the picker, hidden-tab flow, jump badges,
provider invocation prefix, native body-disengage event, and corrected MCP
notice wording.

### Obsolete Django and REST work

Do not port these later paths or their implementation shape:

- `backend/packaging/tests/test_sidecar.py`;
- `backend/pyproject.toml` and `backend/uv.lock`;
- `surfaces/worktracker-agent/pyproject.toml` and its lockfile;
- `surfaces/worktracker-sdk/pyproject.toml` and its lockfile;
- `surfaces/worktracker-typescript-sdk/package.json`;
- Django migration APIs, DRF status-code expectations, sidecar launch, and
  generated REST clients.

The source migration behavior and schema expectations remain evidence. The
Django, Python sidecar, and REST mechanisms are obsolete in the Rust-only app.

### Release-only documentation and artifacts

These paths do not affect CODING-1155:

- `README.md` release availability and screenshot sections;
- `screenshots/agent-review.png`;
- `screenshots/spec-editor.png`;
- `screenshots/work-item-details.png`;
- `studio/release/OPERATIONS.md`;
- `studio/release/manifest.v1.json`;
- version-only edits in `package.json`, `package-lock.json`,
  `studio/package.json`, `studio/src-tauri/Cargo.toml`,
  `studio/src-tauri/Cargo.lock`, and `studio/src-tauri/tauri.conf.json`.

If Ticketry publishes a Rust release, regenerate the release manifest,
instructions, and screenshots from the completed Rust app. Do not use release
copy as proof that CODING-1155 behavior works.

### Unrelated code organization

`studio/src/app/navigation/workItemActivation.ts` changes its import to the
public `appNavigation.ts` barrel, and `appNavigation.ts` exports
`launchFailureMessage`. This is a no-behavior module-boundary cleanup. It does
not change any CODING-1155 requirement.

## Exact post-602596a path disposition

| Disposition | Exact paths |
| --- | --- |
| Required refinement | `backend/worktracker/migrations/0050_module_presentation.py`; `backend/worktracker/tests/test_migration_codex_5_3_model_catalog.py` |
| Downstream installed-artifact follow-up | `studio/scripts/installed-artifact-acceptance-driver.mjs`; `studio/scripts/installed-artifact-acceptance-driver.test.mjs` |
| Obsolete backend or SDK | `backend/packaging/tests/test_sidecar.py`; `backend/pyproject.toml`; `backend/uv.lock`; `surfaces/worktracker-agent/pyproject.toml`; `surfaces/worktracker-agent/uv.lock`; `surfaces/worktracker-sdk/pyproject.toml`; `surfaces/worktracker-sdk/uv.lock`; `surfaces/worktracker-typescript-sdk/package.json` |
| Release-only | `README.md`; `package.json`; `package-lock.json`; `studio/package.json`; `studio/release/OPERATIONS.md`; `studio/release/manifest.v1.json`; `studio/src-tauri/Cargo.toml`; `studio/src-tauri/Cargo.lock`; `studio/src-tauri/tauri.conf.json`; `screenshots/agent-review.png`; `screenshots/spec-editor.png`; `screenshots/work-item-details.png` |
| No-behavior code organization | `studio/src/app/navigation/workItemActivation.ts`; `studio/src/features/agents/terminal/appNavigation.ts` |

## Ordering constraints

1. Finish the earlier 0044 through 0048 schema and adoption work before treating
   0049 through 0051 as a complete upgrade sequence.
2. Finish `CODING-1156` before `CODING-1157` and before final installed-artifact
   fixtures rely on `workspace_tab_order`.
3. Finish `CODING-1164` before `CODING-1165`, `CODING-1166`, and the hidden-tab
   portion of `CODING-1162`.
4. Preserve main's migration order of 0049, 0050, then 0051. Spark insertion is
   logically independent of module presentation, but upgrade provenance and
   tests must cross the same ordered schema history.
5. Run `CODING-1159` only after all product slices and the earlier Workspace
   removal are complete. Adapt the release driver to the final Rust schema at
   that point.
6. `CODING-1158`, `CODING-1160`, `CODING-1163`, and the notice correction in
   `CODING-1167` can proceed independently of the module-presentation migration.

## Final verdict

The corrected answer is no: final main does not override the work already
started under `CODING-1155`. It confirms that work and tightens two migration
requirements. Continue the hierarchy, add the connection-local 0050 migration
rule and the existing-install 0051 adoption case, then update the
installed-artifact gate after the complete schema sequence lands.

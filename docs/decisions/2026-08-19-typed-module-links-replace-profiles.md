# Typed module links replace profiles — decision record

**Date:** 2026-08-19
**Origin:** Ticket #803, grilled before entering Spec
**Method used:** [`../decision-making-method.md`](../decision-making-method.md)

This is the reasoning record, not the plan. The plan is the spec on #803.
Read this before re-opening any question about host-local configuration
persistence — it records the paths already walked and why each was left.

---

## 1. What was decided

The file-backed configuration surface (`profiles.json`, `features.json`) is
not migrated into the database — it is almost entirely **retired**. The
concepts it stored no longer exist in the product:

1. **Profiles are removed.** Not renamed, not made backend-only — removed.
   The profile picker, array-index identity, and the `/config` profile CRUD
   endpoints go with them.
2. **Workspaces are removed, including the `Workspace` model itself.** The
   project is now the largest thing. #803 deletes the model, migrates
   `Project` off its FK, drops `workspace_slug` from agent prompt text, the
   worktrees table, and every config surface.
3. **Studio pins to a single project.** Project selection is removed from the
   UI. The UI opens `resolveDefaultProject`; extra `Project` rows in existing
   databases are left untouched but unreachable from the UI. No destructive
   consolidation.
4. **The only durable backend data that survives is the module → local-path
   binding**, as a new typed table:

   ```
   ModuleLink
     id          UUID
     module      FK → Issue (type='module'), on_delete=CASCADE, unique
     local_path  absolute host path
     created_at / updated_at
   ```

   A separate table, not a column on `Issue`: the Issue row is shared domain
   data; where a module lives on *this machine* is host-local state. The
   unique FK enforces one canonical folder per module. Ephemeral per-run
   checkouts remain the worktrees app's concern.
5. **Feature flags (`sidebar`, `projects`) are retired outright** — they were
   rollout flags for surfaces that are now being removed/final; no flag
   persistence survives anywhere.
6. **Recent-navigation state**: `recent_project_id` is dropped (no project
   selection exists). Recent *module* memory survives — one value, the last
   selected module — persisted **frontend-only** (localStorage/desktop
   store). The backend never carries navigation state again.
7. **Legacy `agent_prompt`/`agent_prompts` are dropped cold.** Live prompts
   already reside on `LaunchBinding` rows; the one-time
   `profile_prompt_migration.py` shim is deleted without a final run.
8. **The agent surface follows the same single-project rule.** MCP project
   discovery returns only the installation project. MCP instructions, Studio
   launch prompts, and repository guidance tell agents and installed skills to
   use the supplied Project ID rather than ask for or search for a project.
   Project-scoped domain and REST contracts remain intact.

## 2. Import and file retirement

- **Best-effort, skip-and-log import:** each `module_links` entry in
  `profiles.json` whose `module_id` resolves to an existing module Issue and
  whose path is a non-empty string becomes a `ModuleLink` row. Invalid
  entries are logged and skipped; a malformed file imports nothing; startup
  never blocks. Duplicate module ids: last one wins (current runtime rule).
- **After import, both files are deleted.** No backup rename, no rollback or
  downgrade support — forward-only, idempotent import.

## 3. API and concurrency

- **One-cut replacement.** The five handwritten `/config` APIViews are
  deleted, replaced by a DRF-native module-links resource (ModelSerializer,
  ViewSet/generics, UUID identity, stable operation IDs). OpenAPI and the
  generated SDK regenerate, and Studio moves to the new operations in the
  same change. No compatibility shim: frontend and backend ship together.
- **Last-write-wins concurrency.** Per-module transactional upserts/deletes;
  clients refetch via TanStack Query. No revision tokens or 409 machinery —
  not justified for independent single-row settings.

## 4. What stays untouched

- Provider catalog persistence and its endpoints.
- Keybindings as open-ended JSON in `AppSetting` — the one justified JSON
  value.
- Stateless folder validation (`POST /config/folders/validate` behavior;
  path may move with the new resource naming).

## 5. Paths walked and left

- **Keep Profile as a user-visible resource** (`ConfigurationProfile` table,
  per-profile module links): rejected — the product no longer has multiple
  workspace bindings to switch between; the concept was carrying only
  ceremony.
- **Singleton `HostConfiguration` row**: rejected — after removing flags,
  active profile, and workspace identity, nothing was left for it to hold.
- **Generic config-type + JSON table**: rejected in the ticket and upheld —
  it forfeits constraints, identity, and DRF convergence.
- **`local_path` column on `Issue`**: rejected — mixes host-local machine
  state into shared domain rows.
- **Migrate legacy prompts one last time**: rejected — the shim depends on
  the Workspace model being removed here, and supported installations have
  completed the prompt move.
- **Scoping #803 to config only, deferring Workspace-model deletion**:
  rejected — the workspace concept is being removed now, in this Story.

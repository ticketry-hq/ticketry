# Settings feature map

## Versioned provider catalog registry

The settings capability owns the supported provider models and reasoning levels.
Its private registry is
[`catalog_registry.rs`](../../studio/src-tauri/crates/config/ticketry-settings/src/provider_catalog_migrations/catalog_registry.rs).
One entry records a migration id, ledger table, source commit, numbered chain
position, provider slug, missing-provider policy, and model names with their
ordered reasoning levels. The historical entries are immutable: preserve their
identities, provenance, content and positions. The ledger version remains
`PROVIDER_CATALOG_MIGRATIONS_VERSION = 1`.

### Add a model or change its reasoning levels

1. Add a **new versioned entry** in `catalog_registry.rs` and include it in
   `REGISTRY` in increasing step order. For a reasoning change, name the existing
   model and supply its complete new reasoning list; never edit its old entry.
   Set `handler: None`, choose the recognised provider slug, and supply unique
   migration and ledger identities with the actual 40-character source commit.
   Model and reasoning names must be nonblank, trimmed and unique within their
   entry/model. An empty reasoning list means no configurable reasoning.
2. Take the **next unused chain step number** across both the catalog registry
   and installation's
   [`non_catalog.rs`](../../studio/src-tauri/crates/execution/ticketry-installation/src/final_schema_migrations/non_catalog.rs).
   Inspect both sources before choosing the number; do not fill historical gaps
   or renumber old steps. Registry validation rejects duplicate ids, ledgers or
   steps and non-increasing catalog order. Installation validates the merged
   chain and rejects catalog/non-catalog step collisions before executing it.
3. Update the expected-catalog tests, including model names/reasoning and the
   expected appended migration descriptor/order where those are asserted.
   The primary full-install expectations are in
   [`final_schema_migration_chain/support.rs`](../../studio/src-tauri/tests/final_schema_migration_chain/support.rs)
   and [`installation_adoption.rs`](../../studio/src-tauri/tests/installation_adoption.rs).

That is one registry entry plus test expectations. A normal model change needs
no new migration wrapper, settings export, public-API fixture entry, installation
runner call, or owned-ledger declaration. `npm run reuse:check` blocks a new per-model
module in `provider_catalog_migrations/` unless its
[exception registry](../../scripts/reuse-gate/provider-catalog-exceptions.mjs)
lists it. The existing
`provision_provider_catalog` remains the baseline provisioning entry point;
versioned changes run through the registry on fresh installs and upgrades.

### Application and integration seams

[`catalog_runner.rs`](../../studio/src-tauri/crates/config/ticketry-settings/src/provider_catalog_migrations/catalog_runner.rs)
validates before opening the transaction, verifies existing ledger provenance,
defers when required tables are absent without recording a ledger, resolves the
provider, applies the content and writes the ledger atomically. Reconciliation
upserts models/reasoning rows, preserves existing model ids, deletes stale joins
and inserts missing joins. Rerunning an accepted ledger leaves rows unchanged.
Missing-provider `Fail` rejects without a ledger; `Skip` records the historical
no-op. Spark and the Astra rename retain `Skip`.

Ordinary entries need provider, model and reasoning-join tables; they need the
reasoning-level table only when they declare levels. The intentional `0057`
GLM Flash correction requires the join table its reconciliation already touches:
an incomplete schema now defers and retries instead of failing its join delete.

The **rename-handler exception** is `CatalogHandler::RenameAstra`, implemented
in focused private
[`codex_6_astra.rs`](../../studio/src-tauri/crates/config/ticketry-settings/src/provider_catalog_migrations/codex_6_astra.rs).
It renames `gpt-5.6-astra` to `gpt-6-astra` in place, retaining the model id and
historical no-op cases. A handler is only for behavior that model reconciliation
cannot express; an entry cannot declare both a handler and models. Transaction
and ledger ownership remain in the shared runner.

The crate-root contract is `provider_catalog_migrations()`, the read-only
`ProviderCatalogMigration` descriptor (`migration_id`, `ledger_table`, `step`),
and `install_provider_catalog_migration(database, descriptor)`. Content and
implementation modules stay private. The seven per-model installers and fourteen
per-model constants are removed; the generic surface, provisioning and version
remain in [`lib.rs`](../../studio/src-tauri/crates/config/ticketry-settings/src/lib.rs).

Installation's
[`final_schema_migrations.rs`](../../studio/src-tauri/crates/execution/ticketry-installation/src/final_schema_migrations.rs)
merges catalog descriptors with non-catalog steps, retaining historical
`ORDERED_MIGRATION_IDS` and error labels. Its
[`classification/rust_ledger.rs`](../../studio/src-tauri/crates/execution/ticketry-installation/src/classification/rust_ledger.rs)
discovers owned catalog ledgers from the same descriptors at the catalog version
and refuses future ledger versions.

### Test seams and delivery gates

| Seam | Coverage |
| --- | --- |
| Settings `catalog_registry/tests.rs`, `catalog_validation/tests.rs` | Frozen historical data; entry validation; identity, ledger and step uniqueness/order. |
| Settings `catalog_runner/tests.rs` | A synthetic next model without a new wrapper; rerun identity; reasoning reconciliation; rejected entries without writes; deferred tables; missing-provider policies. |
| Settings `historical_compatibility_tests.rs`, `historical_installs_tests.rs` | Historical catalog/default identities; rename no-op cases; empty reasoning; intended Flash join-table deferral and retry. |
| Settings `tests/provider_catalog_migrations.rs` | Generic public descriptors; every registered step's tampered provenance, trigger rollback/retry and unchanged rerun ledger. |
| Installation `final_schema_migrations/tests.rs` | Frozen historical chain; increasing steps; cross-source collision rejection; historical error labels. |
| Studio Rust `final_schema_migration_chain`, `installation_adoption`, `catalog_registry_installation`, `installation_classification` | Fresh and partial historical-ledger installations, defaults/ids on reopen, registry ledger classification and future-version refusal. |
| Studio Rust `provider_catalog`, `codex_6_1_catalog`, installation `sprint_migration_chain` | Catalog selection/reopen and rollback behavior; surrounding chain integration. |
| Studio Rust `public_api_boundary_contract` | Exact deliberate exports against `tests/fixtures/public-api.txt`. |
| `overhaulProviderCatalogRuntimeAcceptance.test.tsx` | Existing runtime cases overhaul-79, overhaul-391 and overhaul-407: saved GraphQL catalog/defaults converge and persist on reopen. |

Run `npm run test:catalog-append` to append a synthetic catalog entry in an
isolated source snapshot and exercise both sprint/fresh-install acceptance
tests, model/ledger idempotence, and the frozen historical chain-prefix guards.
The live registry and application data stay untouched.

Run focused Rust suites and settings unit/integration tests, then from the root
run `npm run typecheck`, `npm run test --workspace @worktracker/studio`,
`npm run build --workspace @worktracker/studio`, and
`npm run test:overhaul --workspace @worktracker/studio`. This refactor expects no
user-visible change; the provider-catalog runtime acceptance cases must stay green.

## Settings editor lifecycle

[`shared/editorLifecycle/`](../../studio/src/shared/editorLifecycle) owns the
draft, hydration, save and feedback lifecycle of an editor over one
authoritative value (CODING-2729,
[spec](../plans/CODING-2729-settings-editor-lifecycle-spec.md)). It never
fetches: loading, load failure and the authoritative value come from the
caller's Apollo read, and the save binding owns transport and cache effects.
It imports nothing from `app/`, `features/` or `state/`;
[`moduleBoundaries.test.ts`](../../studio/src/app/__tests__/moduleBoundaries.test.ts)
and the architecture lint
([`frontend-architecture-lint.mjs`](../../studio/scripts/frontend-architecture-lint.mjs))
enforce that.

### Guarantees

The draft follows five rules
([`draftTracking.ts`](../../studio/src/shared/editorLifecycle/draftTracking.ts)):

1. An identity change resets the draft to the new identity's authoritative
   value, not dirty.
2. The first authoritative value for an unhydrated identity is adopted, not
   dirty.
3. A later authoritative change is adopted only while the draft is clean. A
   dirty draft is never overwritten by a refresh.
4. Marking a value saved clears dirty only when the current draft still equals
   that value.
5. Discard restores the current authoritative value and clears dirty.

The draft is component-local unsaved input. It is never written to a store or
the Apollo cache and is lost on unmount.

Save sequencing
([`saveSequencing.ts`](../../studio/src/shared/editorLifecycle/saveSequencing.ts))
has two modes:

- **Explicit commit** (`mode: "commit"`): validate, then send the current draft.
  At most one save per identity runs at a time; a request while one runs is
  ignored. Success marks the sent value saved and, if the draft still equals it,
  shows the binding's authoritative response; the outcome is saved. An edit made
  during the save stays dirty. Failure keeps the draft dirty and editable; the
  outcome is failed with the error.
- **Autosave** (`mode: "autosave"`): a serialized latest-wins queue per
  identity. Only the newest pending input is retained, and each save, including
  its authoritative refresh, completes before the next starts. The first error
  is reported after the queue drains. The queue clears `running` inside the
  drain itself, not in a later `Promise.finally()`, so an edit enqueued as the
  drain finishes is not stranded (the drain-completion race). The draft adopts
  the saved value through the binding's refresh of the authoritative read
  (rule 3).

A save binding that resolves `null` reports a write that did not land, so
nothing is marked saved and the outcome is left unchanged: neither saved nor
failed.

**Identity scoping.** A save that completes for a no-longer-current identity
(or after unmount) marks nothing saved, changes no field and sets no status.
The saving indicator reflects only the current identity.

**Status model** (`EditorStatus`): `loading`, `loadError`, `saving`, `dirty`,
`validation` (the first field message in declaration order, else the record
message), `outcome` (`none`, `saved`, or `failed` with `error`), `canSave`
(hydrated, not loading or saving, dirty and valid) and `canDiscard` (hydrated,
not loading or saving, and dirty). Editing or discarding clears the outcome. The
lifecycle supplies states; the surface supplies wording.

**Save errors.** `saveErrorMessage(error)` returns an `ApiError`'s string
`detail`, else its 422 list of `msg` entries joined with "; ", else the error's
own message.

The defect history lives next to the code it shaped: ticket #1372 (a form
mounted before its value loaded saved a stale empty prompt) in
`draftTracking.ts`, and the drain-completion race in `saveSequencing.ts`.

### Entry points

Everything is exported only from
[`shared/editorLifecycle/index.ts`](../../studio/src/shared/editorLifecycle/index.ts).

| Export | Purpose |
| --- | --- |
| `useEditorLifecycle(options)` | The lifecycle hook. Options: `identity`; `authoritative` (`undefined` while not hydrated); `equals`; `empty` (the draft shown before hydration); `loading`; `loadError`; `validate(draft)`; `mode` (`"commit"` or `"autosave"`); `save` (a `SaveBinding`); optional `savedDraft` mapping an autosave input back to the draft it represents. Returns `draft`, `edit` (value or updater), `discard`, `save(input?)` (never rejects; failures land in `status`) and `status`. |
| `DescriptorEditor` | A full ordinary-setting editor from an `EditorDefinition`: status line, fields and, in commit mode, Discard plus Save (accessible name `saveLabel`, text "Save changes" or "Saving…"). Autosave saves on checkbox change and when a text field is left, and shows "Applying…". Fields are disabled while loading. |
| `DescriptorFields` | The declared fields only, for surfaces that lay out their own buttons. |
| `validateDraft(definition, draft)` | The first field message in declaration order, else the record message, else `null`. |
| `saveErrorMessage(error)` | The actionable message for a failed save (above). |
| `EditorDefinition` | `fields`, record-level `validate`, `equals`, `empty`, `saveLabel`, `messages`. |
| `FieldDescriptor` | `TextFieldDescriptor` (`kind: "text" \| "multiline"`, `maxCharacters`, `counter`, `placeholder`, `rows`, `monospace`, `validate(value, draft)`) or `CheckboxFieldDescriptor` (`kind: "checkbox"`, `validate(value, draft)`). Both take `key`, `label` (the accessible name), and optional `heading` and `description`. |
| `EditorMessages` | `saved`, `loadFailed`, and an optional fixed `saveFailed` (defaults to `saveErrorMessage`). |
| `SaveBinding` | `(input) => Promise<saved \| null>`: resolves with the authoritative saved value, or `null` when the write did not land. |

Types `EditorLifecycle`, `EditorLifecycleOptions`, `EditorStatus`, `SaveMode`,
`SaveOutcome`, `DraftUpdate` and `ValidationMessage` are exported too.

**Adopters.** No user-visible surface uses the module yet. The CODING-2729 spec
plans three adopters in follow-up tickets: Launch configuration (autosave),
Conversations settings (commit, with in-panel buttons) and Model configuration
(commit, through the Settings commit bar). The launch configuration form still
uses its private
[`launchBindingFields`](../../studio/src/features/workflows/internal/launchBindingFields.ts)
and
[`launchBindingSaveQueue`](../../studio/src/features/workflows/internal/launchBindingSaveQueue.ts)
hooks, which the lifecycle generalizes.

### Declare an ordinary setting

Declare the draft and its definition; there is no lifecycle code to write
(modeled on the test fixture):

```ts
import type { EditorDefinition } from "../../shared/editorLifecycle";

export interface DigestSetting {
  title: string;
  shared: boolean;
}

export const digestSettingEditor: EditorDefinition<DigestSetting> = {
  fields: [
    {
      key: "title",
      kind: "text",
      label: "Digest title",
      maxCharacters: 40,
      counter: true,
      validate: (title) => {
        if (!title.trim()) return "A digest title is required.";
        return title.trim().length < 3
          ? "A digest title needs at least 3 characters."
          : null;
      },
    },
    { key: "shared", kind: "checkbox", label: "Share digest with the team" },
  ],
  validate: (digest) =>
    digest.shared && digest.title.trim().toLowerCase() === "private"
      ? "A shared digest cannot be titled “private”."
      : null,
  equals: (a, b) => a.title === b.title && a.shared === b.shared,
  empty: { title: "", shared: false },
  saveLabel: "Save digest settings",
  messages: {
    saved: "Digest settings saved.",
    loadFailed: "Digest settings could not be loaded.",
  },
};
```

Then render it:

```tsx
<DescriptorEditor
  definition={digestSettingEditor}
  identity={identity}
  authoritative={authoritative}
  loading={loading}
  loadError={loadError}
  mode="commit"
  save={binding}
/>
```

`authoritative`, `loading` and `loadError` come from the feature's Apollo
watched query. `binding` runs the generated mutation, writes its response into
that read, and resolves with it.

Domain-specific editors (the Launch default picker, Stage skills, provider
activation and Codex profiles) stay explicit components. They call
`useEditorLifecycle` directly and use `DescriptorFields` only for ordinary
controls.

### Test coverage

[`settingsEditorLifecycle.test.tsx`](../../studio/src/test/settingsEditorLifecycle.test.tsx)
renders the test-only harness
[`digestSettingFixture.ts`](../../studio/src/test/digestSettingFixture.ts)
through `DescriptorEditor`. The harness declares a single-line text field with a
required/minimum-length validator, capped at 40 characters with a counter, a checkbox and a record-level
validator. A host stands in for the Apollo read with a stub authoritative value
and a stub save binding; deferred promises drive the timing. The cases cover:

- rendering every declared field with its accessible name;
- dirty tracking, with Save and Discard enabled only while the draft differs;
- validation blocking save, field message first, then the record message;
- a successful save adopting the authoritative value it returns;
- an edit made during an in-flight save staying dirty;
- a failed save keeping the draft and showing the server's reason;
- discard restoring the current authoritative value;
- an identity switch resetting the draft;
- a late save for the old identity leaving the new one untouched;
- delayed hydration of an editor mounted before its value arrives;
- a failed load reported with the declared wording;
- a binding that resolves `null` reporting nothing saved and keeping the draft;
- a later authoritative change updating a clean draft but not a dirty one;
- autosave serializing a burst and sending the newest value last.

## Documentation location

Neither this path nor `docs/feature-map/workflows-and-issue-types.md` existed in
the checkout or its available Git history when CODING-2736 was implemented.
Targeted tracked-path and all-ref history searches found no relocated copy.
This settings entry is newly created; it does not reconstruct an unavailable
workflow/issue-type feature map.

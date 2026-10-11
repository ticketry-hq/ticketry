# Public exposure conformance (CODING-2651)

These modules are a test-internal source contract. They add no shipping service,
crate exports, or product operation. `public_api_boundary_contract` is the mandatory shipping-workspace guard. It
resolves all 22 Cargo library roots after facade contraction; compatibility module
exports and generic legacy exceptions are forbidden.

Run fixtures independently of desktop dependencies:

```sh
cargo test --locked --manifest-path studio/src-tauri/tests/public-api-fixtures/Cargo.toml --test public_api_fixture_contract
```

The same fixture entry point is discoverable by the shipping workspace:

```sh
cargo test --locked --manifest-path studio/src-tauri/Cargo.toml -p ticketry --test public_api_fixture_contract
cargo test --locked --manifest-path studio/src-tauri/Cargo.toml -p ticketry --test public_api_generated_compile
```

`source` loads inline, conventional file, `#[path]`, and conditional alternative
modules. `source_locations` follows the physical directory behavior established
by Rust compiler fixtures. `source_imports` expands grouped, renamed, and grouped
self imports. `workspace` reads Cargo metadata for workspace membership, library
roots, and dependency aliases. Conflicting conditional dependency aliases fail
rather than selecting an arbitrary target.
For canonical macro dependencies it also checks the full locked Cargo graph
with all features, including every conditional alias and transitive macro owner.
`workspace_origins` records exact reviewed versions for serde, SeaORM/migration,
Seaography, async-trait, async-graphql, Tokio, Tauri, TauRPC, schemars and serde_json,
including their procedural-macro owners and framework re-export owners. Every
conditional dependency edge is checked against the locked crates.io graph; path,
workspace, patch and version substitutions require explicit handling and compiler
evidence.

`resolve` follows crate/self/super, absolute dependency imports, extern-crate
aliases, and re-export chains. A leaf, namespace, and entire crate are different
targets. Diagnostics retain source, caller export, resolution chain, and cfg
evidence. Private implementation paths can qualify an explicitly exported item;
private ancestors alone do not make their other declarations reachable. Outside
crate paths require public bindings. Public root globs, cycles, unresolved paths,
associated-item paths, and unknown external dependency targets fail explicitly.
Rust's value/type namespace distinction permits a named function beside its
private same-name implementation module or imported entity namespace; resolving
an intermediate path still selects the namespace rather than recursing through
the function alias.

`policy` rejects implementation namespaces, entire crate exports, and public
globs before comparing approvals or refreshing files. `inventory` preserves
`public-api.txt`'s deliberate names and supplements them with exact kind and
gating evidence; changing names cannot approve structurally invalid exposure.
`exception_records` loads the dedicated generated namespace records, and
`exceptions` validates their evidence. Exact reachable descendant paths, kinds,
and conditions are compared as a union, including additions hidden behind an
unchanged root name. Ordinary inherent methods are outside this namespace audit.
Test-support namespace exceptions are rejected, including nested and negated
feature evidence; similarly named features do not match that restriction.

## Conditional source and macros

The scanner audits every source-visible cfg branch. It does not evaluate the
host's cfg and skip inactive declarations. Alternate cfg_attr module paths and
the default path (with complement evidence) are inspected. Nested conditional
attributes retain their conditions; unsupported or nonliteral forms fail closed.
Compilation remains the authority for active signatures and valid configurations.

Built-in and serde derives are explicitly supported as trait implementations.
The only supported namespace-generating macros are the pinned SeaORM 2.0.1
`DeriveEntityModel` and argument-free `sea_orm::model` on the concrete public
`Model` with a table attribute. Their 16 namespace items are explicitly modeled,
including Entity, ActiveModel, Column, PrimaryKey, relation/extended model types,
loader types and trait, TypedColumn, and COLUMN. Trait-only derive/attribute expansions are also explicitly supported for
Seaography custom inputs/outputs/fields, SeaORM query/migration derives,
async-trait, async-graphql Object, schemars and Tokio tests. Tauri commands model
both generated root helper macros, including conditional/restricted definitions;
the conditional mobile entry point models its non-Android `start_app` function.
Standard thread-local and Tokio task-local items model each declared static;
Seaography entity-module registration models its single public function. Literal
item `include!` paths load the included source, retaining root macro exports and
cycle/shadow diagnostics. Nonliteral include paths remain unsupported. The
single-arm desktop handler wrapper accepts only the reviewed Tauri path-list
expression grammar. Other macro arguments and unknown custom derives,
attributes or item macros require explicit source handling and a compiler probe. They cannot pass as unresolved leaf capabilities.
Public macro definitions are named root exports, including macro_export from a
private module. Parsing these definitions does not expand invocations.
Raw identifiers and imported aliases cannot disguise macro provenance. Known standard and reviewed framework body macros are allowed only when their
names and dependency roots are unshadowed. Workspace glob provenance follows
actual source scopes; an unknown competing glob fails. Nested serde derives
retain canonical dependency checks and cannot be replaced by a local import. Nested invocations receive the same checks. Source-visible exporting
attributes, procedural derives, and local import/item scopes hidden in opaque
macro arguments fail explicitly. Other body macros need supported expansion
handling and compilation, even when their surrounding function is already named.

The separate shipping compiler probe imports all 16 items across the 40 retained
entity namespaces, checks Entity/Model/ActiveModel/Column/PrimaryKey and loader
trait contracts, relation iteration, and actual Seaography registration signatures.
It also checks the pinned macro package version so a framework upgrade requires
review of the modeled expansion. Source approval alone is not compiler evidence.
The compile verifier runs one exact recorded test and rejects zero-test success.

## CODING-2653 workspace enforcement

The shipping `library_roots_are_the_only_public_facades` test calls
`guard::check_workspace`. The isolated fixture manifest also runs that exact test
against the shipping manifest, so it does not replace desktop default features.
The guard loads every Cargo library root, checks structural exposure, compares
exact names/kinds/cfg evidence and descendants, and executes the exact protecting
entity and workspace-macro compiler tests. Zero-test success fails. The workspace
macro probe imports the real generated Tauri root helpers and compiles the
reviewed trait/runtime/registration/mobile expansions; the enabled
`desktop-acceptance` witness verifies its two additional command helpers.

`UPDATE_PUBLIC_API=1` runs structural validation and requires the named set to
already equal the reviewed `fixtures/public-api.txt` before refreshing evidence.
`policy::write_approval_files` validates exact exceptional descendants and both
compiler probes before writing. It cannot approve a namespace or silently accept
growth behind an exceptional namespace. `fixtures/public-api-evidence.txt`
records each resolved kind and source-union cfg branch. No environment flag
suppresses structural checks or compiler evidence.

Only generated descendants remain in the entity exceptions. Authored sprint
status constants and receipt helpers are separate named roots with their
implementation modules private. Scanner/source and compiler evidence are
separate from the Story's assembled MCP/GraphQL and desktop runtime checks.

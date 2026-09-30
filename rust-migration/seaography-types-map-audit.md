# Seaography per-column type-map audit

## Question and version

Ticketry pins `seaography = 2.0.0-rc.9` with `with-chrono` and `with-json`, so
the checked-in dependency declaration matches the tag in the three source links
being evaluated ([Ticketry dependency](../studio/src-tauri/Cargo.toml#L32-L34)).
This note evaluates what `ColumnOptions` can replace in Ticketry and, equally
importantly, what it cannot replace.

## Conclusion

`ColumnOptions` is a **per-entity-column GraphQL codec**, not a mutation hook or
an object projection facility. It can make a generated Seaography field use a
different GraphQL `TypeRef`, parse that field into one `sea_orm::Value`, and
format that one stored value on output. This is enough to remove Ticketry's
repeated compact-UUID, timestamp, and JSON-string-list adapters from generated
entity paths. It is not enough to enforce database invariants, coordinate two
columns, update relationships, compute aggregate fields, restrict which rows an
update touches, or change a generated mutation's top-level result object.

The immediate useful move is therefore:

1. replace Ticketry's default `BuilderContext` with a configured context;
2. install reversible UUID codecs on every UUID-backed `String` column;
3. install an output timestamp formatter where SQLite `DateTime` needs the
   public UTC representation;
4. map `launch_binding.required_skills` from database `Json` to GraphQL
   `[String!]!` in both directions;
5. exercise those codecs first in the isolated generated-mutation audit schema;
6. then use generated entity models as the result types for row-shaped seams.

This advances the lowest-complexity mutations, especially transition rows and
launch bindings, but it does not by itself make unrestricted generated CRUD safe.
Lifecycle hooks, protected-field skips/guards, transactions, database constraints,
and the existing command layer remain responsible for domain behavior.

## What the extension points do

Seaography stores options in a `BTreeMap<EntityColumnId, ColumnOptions>`, making
every override specific to one entity column. `EntityColumnId::of::<T>` derives
the key from the SeaORM table and column, so two text columns may use different
codecs ([`TypesMapConfig` and `ColumnOptions`](https://github.com/SeaQL/seaography/blob/2.0.0-rc.9/src/builder_context/types_map.rs#L19-L45),
[`EntityColumnId`](https://github.com/SeaQL/seaography/blob/2.0.0-rc.9/src/builder_context/entity_column_id.rs#L7-L39)).

| Option | Exact effect | Does not do |
|---|---|---|
| `overwrite: Option<ConvertedType>` | Changes the fallback `ConvertedType` used when parsing a GraphQL value into a `sea_orm::Value`. Seaography checks it before its `ColumnType` match. | It does not change the GraphQL schema type. `input_type_for_column` and `output_type_for_column` separately inspect `input_type` and `output_type`, then fall back to the original SeaORM `ColumnType`. |
| `input_conversion` | Replaces default parsing for that column and returns one `sea_orm::Value`. | It cannot access resolver context, the database, the active model, sibling input fields, or an async operation. |
| `output_conversion` | Replaces the generated entity field resolver's default conversion for that column. It receives `&sea_query::Value` and returns an optional dynamic `FieldValue` or GraphQL error. | It cannot access resolver context, load relations, inspect sibling columns, mutate data, or run async work. |
| `input_type` | Replaces the generated GraphQL `TypeRef` for that column in entity inputs and the primary-key-by-id argument. | It only names/shapes the field. It performs no parsing and registers no custom scalar. |
| `output_type` | Replaces the generated GraphQL `TypeRef` for that entity output field. | It only declares the type. It neither performs conversion nor changes the surrounding entity/basic object. |

Sources: the function signatures and option fields are defined together
([`FnInputTypeConversion`, `FnOutputTypeConversion`, and `ColumnOptions`](https://github.com/SeaQL/seaography/blob/2.0.0-rc.9/src/builder_context/types_map.rs#L9-L32));
`overwrite` is consulted only in converted-type selection
([`sea_orm_column_type_to_converted_type`](https://github.com/SeaQL/seaography/blob/2.0.0-rc.9/src/builder_context/types_map.rs#L91-L110));
the input parser short-circuits to `input_conversion`
([`async_graphql_value_to_sea_orm_value`](https://github.com/SeaQL/seaography/blob/2.0.0-rc.9/src/builder_context/types_map.rs#L232-L259));
and input/output `TypeRef` selection is independent
([`input_type_for_column` and `output_type_for_column`](https://github.com/SeaQL/seaography/blob/2.0.0-rc.9/src/builder_context/types_map.rs#L376-L432)).

The user's second `types_map.rs` range is therefore not a new custom-type
registration mechanism. Lines 217-228 are the panic for a SeaORM type that has
no built-in converted-type mapping; lines 232 onward begin the input conversion
path. An `overwrite` can avoid that converted-type panic, but an unsupported
`ColumnType::Custom` still has no default GraphQL type and needs an explicit
`input_type`/`output_type` as well
([unsupported converted types](https://github.com/SeaQL/seaography/blob/2.0.0-rc.9/src/builder_context/types_map.rs#L193-L229),
[`ColumnType::Custom` has no default GraphQL `TypeRef`](https://github.com/SeaQL/seaography/blob/2.0.0-rc.9/src/builder_context/types_map.rs#L307-L365)).

## Where the conversions run

### Mutation inputs

Seaography builds both insert and update input objects by iterating entity
columns, applying insert/update skips, and calling `input_type_for_column`.
Insert fields are normally non-null only when the database column is required
and has neither an auto-increment key nor a default; update fields are normally
nullable ([generated entity input construction](https://github.com/SeaQL/seaography/blob/2.0.0-rc.9/src/inputs/entity_input.rs#L61-L120)).

At execution, the input object parser iterates present fields and invokes the
per-column input conversion. Omitted fields never call it. The resulting map is
then copied column-for-column into the active model
([input parsing](https://github.com/SeaQL/seaography/blob/2.0.0-rc.9/src/inputs/entity_input.rs#L141-L172),
[`prepare_active_model`](https://github.com/SeaQL/seaography/blob/2.0.0-rc.9/src/mutation/entity_create_one_mutation.rs#L140-L173)).

Consequences:

- omission versus explicit `null` already remains distinguishable for an
  ordinary nullable column: omission bypasses the parser; explicit `null`
  reaches it;
- a parser can normalize or validate one supplied scalar/list, but its return
  value is assigned to that same SeaORM column;
- it cannot turn `blockedByIds` into `issue_blocker` rows, transition a state,
  reparent a work item, allocate a sequence/rank, or enforce a workflow revision;
- it is the wrong place for database-backed uniqueness, authorization, locking,
  cascades, or cross-field validation.

There is an important nullability limitation. `input_type` is a fixed `TypeRef`
returned verbatim; it does not receive Seaography's computed `not_null` flag.
The same option is reused for insert and update. Thus an explicit non-null custom
type makes the update field required too, while a nullable custom type weakens
insert validation. Prefer leaving `input_type` unset when the built-in GraphQL
shape is sufficient (UUID normalization can keep `String`), and cover any
unavoidable custom-shape mismatch with schema tests plus database/hook validation
([verbatim override behavior](https://github.com/SeaQL/seaography/blob/2.0.0-rc.9/src/builder_context/types_map.rs#L376-L403)).

The parser is also broader than mutations: the same function parses a generated
query's primary-key `id` argument and filter operands
([query-by-id parsing](https://github.com/SeaQL/seaography/blob/2.0.0-rc.9/src/query/entity_query_field.rs#L105-L142),
[filter-condition parsing](https://github.com/SeaQL/seaography/blob/2.0.0-rc.9/src/builder_context/filter_types_map.rs#L600-L681)).
That is desirable for Ticketry UUID normalization, but a mutation-specific
parser would unexpectedly change read/filter semantics.

### Mutation and query outputs

The linked `entity_object.rs` code fetches `output_conversion` while building
each generated entity field. At resolver time it downcasts the parent to the
SeaORM model, extracts exactly that column with `object.get(column)`, and either
calls the custom formatter or uses the default value converter
([generated output field construction and conversion](https://github.com/SeaQL/seaography/blob/2.0.0-rc.9/src/outputs/entity_object.rs#L119-L195)).

Generated create returns the inserted model as the entity's `Basic` object, and
generated update returns a list of models as `Basic` objects
([create-one result](https://github.com/SeaQL/seaography/blob/2.0.0-rc.9/src/mutation/entity_create_one_mutation.rs#L77-L136),
[update result](https://github.com/SeaQL/seaography/blob/2.0.0-rc.9/src/mutation/entity_update_mutation.rs#L86-L168)).
Both basic and full entity objects are built through the same column-field
builder, so output conversions apply to generated query fields and generated
mutation result fields. They do not apply to Ticketry's hand-authored DTOs,
because those use `CustomOutputType` instead of a SeaORM model parent.

The formatter can therefore hyphenate one UUID, add a UTC suffix to one
timestamp, or turn one JSON array into a GraphQL list. It cannot produce
Ticketry's `WorkItem.key`, `subIssuesCount`, `blockedByIds`, or `blocksIds`:
those require project and relationship data, and the callback has only the one
stored value. Ticketry's current projection confirms those fields are computed
from project and blocker queries rather than issue columns
([work-item projection](../studio/src-tauri/src/work_management/read_queries.rs#L242-L291),
[issue entity columns and relations](../studio/src-tauri/src/entities/work_management/issue.rs#L6-L54)).

Finally, a `TypeRef` that names a genuinely custom scalar is not self-registering.
Seaography exposes `Builder::register_scalar`, and schema assembly registers the
builder's scalar collection separately
([scalar registration API](https://github.com/SeaQL/seaography/blob/2.0.0-rc.9/src/builder.rs#L370-L390),
[schema registration](https://github.com/SeaQL/seaography/blob/2.0.0-rc.9/src/builder.rs#L476-L518)).
Built-ins such as `String`, `ID`, and lists of them need no extra scalar.

## Concrete Ticketry use

Ticketry currently creates a completely default context
([schema context](../studio/src-tauri/src/query_root.rs#L18-L35)). Replace that
initializer with a function that starts from `BuilderContext::default()` and
inserts `ColumnOptions` keyed with `EntityColumnId::of::<Entity>(&Column::...)`.
Keep the configuration in one small module so the production and audit schemas
cannot drift.

### 1. UUID-backed strings: highest leverage

For every UUID primary/foreign-key `String` column:

- leave `overwrite`, `input_type`, and `output_type` unset, preserving
  Seaography's normal `String` schema and computed nullability;
- set `input_conversion` to validate a UUID-like string and return the compact,
  lowercase database representation as `sea_orm::Value::String`;
- set `output_conversion` to format a compact stored string as the public
  hyphenated representation.

This moves the existing `uuid`/`database_uuid` boundary conversion into the
generated contract once. Because the parser is also used for generated IDs and
filters, queries and mutations will agree automatically. It directly removes
repetitive field-by-field mappings visible in Ticketry's read layer
([current UUID query and result conversions](../studio/src-tauri/src/work_management/read_queries.rs#L134-L188)).

Do this before enabling any generated mutation: primary-key filters otherwise
compare public hyphenated IDs with compact database values, and generated
mutation outputs otherwise return compact IDs.

### 2. SQLite `DateTime`: useful, output-only

Ticketry's entities use SeaORM `DateTime`, while the public projection appends
`Z`. Seaography's global `timestamp_rfc3339` switch only changes UTC/local/timezone
timestamp variants; its `ChronoDateTime` branch still calls `to_string()`
([default chrono output conversion](https://github.com/SeaQL/seaography/blob/2.0.0-rc.9/src/outputs/entity_object.rs#L291-L333)).
Therefore Ticketry needs per-column `output_conversion` for its SQLite
`created_at`/`updated_at` fields if exact existing wire compatibility matters.
No `output_type` override is needed because the GraphQL type remains `String`.

### 3. `launch_binding.required_skills`: useful custom shape

The model stores `required_skills` as `Json`
([entity column](../studio/src-tauri/src/entities/work_management/launch_binding.rs#L6-L18)),
while Ticketry publishes a non-null string list through a hand-written wrapper
([current `StringList`](../studio/src-tauri/src/query_root/types.rs#L7-L42)).
For the generated entity field, set:

- `output_type` to `[String!]!` and `output_conversion` to require a JSON array
  of strings and return `FieldValue::list`;
- `input_type` to a list of strings and `input_conversion` to return a JSON
  `sea_orm::Value`.

This can eliminate the wrapper on generated launch-binding reads/results. Test
explicit null, non-string members, duplicate strings, and create-versus-update
nullability. Because the fixed `input_type` cannot express required-on-insert
but optional-on-update, use a nullable input list or keep the field out of one
generated input and enforce the required create value below GraphQL.

### 4. Which authored output types can shrink

Once the codecs are installed, row-shaped outputs can use registered SeaORM
entity models rather than mirrored `CustomOutputType` structs. Best candidates
are:

1. `IssueTypeTransition` — entirely stored scalar columns;
2. `LaunchBinding` — stored columns once `required_skills` is mapped;
3. `Workspace`, `Provider`, and `ReasoningLevel` — row-shaped, subject to the
   intended field allowlist;
4. `State` and `IssueType` — row-shaped values, but current public names replace
   foreign-key column names (`project`, `startState`) and their contracts must be
   deliberately migrated to model-shaped `projectId`/`startStateId` fields;
5. `Project` — technically row-shaped, but the current DTO intentionally omits
   internal counters/revisions/timestamps, so output exposure must be resolved
   independently.

`Module`, `WorkItem`, and `AgentModel` remain projections: they contain derived
keys, counts, blocker/reasoning lists, or filtered entity views not representable
by a one-column formatter. The current type definitions make that distinction
visible ([Ticketry output types](../studio/src-tauri/src/query_root/types.rs#L44-L165)).

## What this does not unblock

These options do **not** change Seaography's all-or-nothing per-entity mutation
registration, add per-operation field allowlists, change update filtering, or
provide lifecycle transactions. In particular they cannot make these safe:

- `create_project` aggregate initialization;
- `delete_project` aggregate teardown;
- workflow revision compare-and-swap;
- issue-type reassignment on delete;
- filesystem attachment creation;
- work-item transition, hierarchy, blockers, archive cascades, sequence/rank,
  or derived-field repair;
- reorder and remove-state-from-workflow domain operations.

Generated update still takes one column map and applies it through
`update_many`; the relevant resolver begins a transaction but the type codec
has no access to it or to the matched models before the update
([generated update execution](https://github.com/SeaQL/seaography/blob/2.0.0-rc.9/src/mutation/entity_update_mutation.rs#L86-L153)).
Treat the codec configuration as wire-format infrastructure underneath the
existing hooks/commands, not as their replacement.

## Recommended proof sequence

1. Add table-driven unit tests for compact/hyphenated UUID input and output,
   including null and malformed input.
2. Reuse the same configured context in the isolated generated-CRUD audit
   schema and snapshot its SDL. Assert insert/update nullability explicitly.
3. Execute generated query-by-id and filter cases as well as create/update,
   because `input_conversion` is shared by all of them.
4. Add round-trip tests for `required_skills`, including conversion errors.
5. Port transition-row outputs to entity models first, then launch-binding
   outputs. Only after invariant tests pass should their generated mutation
   paths replace authored mutation fields.
6. Keep projection DTOs for work items/modules and keep named domain operations
   where model CRUD cannot express the behavior.

## Project-structure comparison with the official 2.0 layout

Seaography's generated baseline places one SeaORM entity module per table under
`src/entities/`; `entities/mod.rs` is the inventory that registers entity
modules and active enums. Its GraphQL composition boundary is `query_root.rs`,
which owns the static `BuilderContext`, constructs the builder, registers
entities, applies limits, attaches schema data, and returns the schema builder.
The documentation explicitly assigns type mappings, field guards, and lifecycle
hooks to that central context
([generated entities and inventory](https://www.sea-ql.org/Seaography/docs/getting-started/project-structure/#entities),
[`query_root.rs` and `BuilderContext`](https://www.sea-ql.org/Seaography/docs/getting-started/project-structure/#query_rootrs)).

For custom endpoints, the official extension layout adds
`query_root/{types,queries,mutations}.rs`; top-level `query_root.rs` declares
those modules and explicitly registers each category on the same builder
([custom-endpoint project structure](https://www.sea-ql.org/Seaography/docs/custom-endpoints/project-structure/)).

Ticketry broadly follows that composition shape: entity modules live under
`studio/src-tauri/src/entities/`, the root context and builder live in
`query_root.rs`, and Work Management custom types and operations are split under
`query_root/` ([current root](../studio/src-tauri/src/query_root.rs#L1-L45),
[current entity registration](../studio/src-tauri/src/entities/work_management/mod.rs#L1-L39)).
The remaining structural divergences are:

- Work Management entities are hand-authored mappings for Django-owned tables,
  rather than generated files with a generated registration inventory.
- The root context is still `BuilderContext::default()`, so the type codecs
  identified above have not yet been centralized there.
- `query_root/queries.rs` registers custom outputs **and mutations**, while the
  documented layout keeps query and mutation registration in their named
  modules ([current mixed registration](../studio/src-tauri/src/query_root/queries.rs#L1-L18)).
- Settings and Runs register custom GraphQL types and operations from their
  persistence modules, making `query_root.rs` an orchestrator of several
  domain-local registrars rather than the single explicit inventory shown in
  the small official example. That domain split is reasonable for Ticketry's
  larger application, but the root should remain the visible composition seam.
- Generated Work Management entities are registered read-only with
  `mutation: false`; custom mutation modules therefore still carry model-shaped
  CRUD as well as genuine domain-operation exceptions.

The useful convergence is modest: add one configured context module for column
codecs/guards/hooks, reuse it in product and audit schemas, move Work Management
custom registration into clearly named `types`, `queries`, and `mutations`
registrars, and keep entity inventory under `entities/`. Then remove custom
model-shaped endpoints as generated CRUD becomes safe, leaving only the named
domain-operation exceptions under `query_root/mutations/`. This is an
organizational aid to the migration, not a reason to flatten Ticketry's domain
services or move transactional behavior into GraphQL files.

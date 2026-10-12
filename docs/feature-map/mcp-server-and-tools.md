# MCP server and tools feature map

Coding agents reach Ticketry through one MCP tool surface. The listener lives in
the `ticketry-mcp` crate
([`crates/surfaces/ticketry-mcp`](../../studio/src-tauri/crates/surfaces/ticketry-mcp/src/lib.rs)).
It serves newline-delimited JSON-RPC on `<data-directory>/mcp.sock` under the
data-directory ownership guard. Providers speak stdio to the packaged
`ticketry-hook mcp` bridge
([`crates/app/ticketry-hook`](../../studio/src-tauri/crates/app/ticketry-hook/src/bridge.rs)),
which forwards to that socket. There is no MCP TCP port.

## Tool surface

[`tool_surface.rs`](../../studio/src-tauri/crates/surfaces/ticketry-mcp/src/tool_surface.rs)
composes the one published list of 35 tools. There is one registration
mechanism: each capability module returns its own `TypedTools` (one rmcp
`ToolRouter` plus Ticketry's per-tool markers), built only from
[`TypedTool`](../../studio/src-tauri/crates/surfaces/ticketry-mcp/src/tool_surface/typed_tool.rs)
definitions, and `ToolSurface::build` merges them:

| Capability module | Tools |
| --- | --- |
| [`connectivity_tools.rs`](../../studio/src-tauri/crates/surfaces/ticketry-mcp/src/connectivity_tools.rs) | `mcp_ping` |
| [`read_tools.rs`](../../studio/src-tauri/crates/surfaces/ticketry-mcp/src/read_tools.rs) | `get_task_details`, `list_projects`, `list_modules`, `list_issue_types`, `list_tasks`, `get_task_scope_context`, `get_dependency_graph`, `get_issue_type_workflow_settings` |
| [`work_item_tools.rs`](../../studio/src-tauri/crates/surfaces/ticketry-mcp/src/work_item_tools.rs) | `create_task`, `create_sub_task`, `create_review_finding`, `add_task_tags`, `update_task`, `append_task_description`, `update_task_status` |
| [`workflow_policy_tools.rs`](../../studio/src-tauri/crates/surfaces/ticketry-mcp/src/workflow_policy_tools.rs) | `add_/remove_issue_type_workflow_transition`, `set_issue_type_workflow_transition_permission`, `_start_state`, `_auto_start`, `clear_issue_type_workflow_launch_binding`, `upsert_issue_type_workflow_launch_binding` |
| [`dependency_tools.rs`](../../studio/src-tauri/crates/surfaces/ticketry-mcp/src/dependency_tools.rs) | `set_task_blockers`, `add_task_blocker`, `add_task_dependent`, `reparent_tasks` |
| [`attachment_tools.rs`](../../studio/src-tauri/crates/surfaces/ticketry-mcp/src/attachment_tools.rs) | `attach_file` |
| [`launch_tools.rs`](../../studio/src-tauri/crates/surfaces/ticketry-mcp/src/launch_tools.rs) | `run_now`, `execute_dependency_graph`, `launch_default_coding_agent` |
| [`run_termination.rs`](../../studio/src-tauri/crates/surfaces/ticketry-mcp/src/run_termination.rs) | `terminate_current_run` |
| [`sprint_tools.rs`](../../studio/src-tauri/crates/surfaces/ticketry-mcp/src/sprint_tools.rs) | `get_sprint_goals`, `suggest_sprint_story` |
| [`codex_thread_rename.rs`](../../studio/src-tauri/crates/surfaces/ticketry-mcp/src/codex_thread_rename.rs) | `rename_codex_thread` |

`ToolCall` carries the database, the authorized `RunPrincipal`, attachment
storage, launch policy resolver, graph run service, terminal services and
resident Codex title service those handlers use.

CODING-2746 removed the last handwritten pieces: the `registry.rs` schema
construction and name-match routing (deleted in CODING-2745), the
`DispatchOutput` answer type and `dispatch.rs`, the `serde_json::Value`
argument helpers, and the handwritten empty schema for argument-less tools,
which now derives from a typed `NoParameters`. The shared `CommandError`
rendering lives in
[`tool_surface/command_rejection.rs`](../../studio/src-tauri/crates/surfaces/ticketry-mcp/src/tool_surface/command_rejection.rs).
Two guards keep it that way: composition refuses any router route that was not
declared through `TypedTool`, and a source guard fails if a handwritten
object schema, a raw `ToolRoute`/`JsonObject` outside `tool_surface/`, or
`DispatchOutput` reappears.

Everything that needs the tool list reads it from the surface:

- `tools/list`. Bearer connections see only the tools their grant allows.
- `allowed_provider_operations()`: every published name plus
  `provider_lifecycle`. Launched runs are granted this list.
- The provider-mutation exception check
  ([`operation_registry.rs`](../../studio/src-tauri/crates/surfaces/ticketry-mcp/src/operation_registry.rs)),
  which startup runs.

If a name is published twice (by one or two typed routers), or a route reaches
the router without a typed definition, startup fails before the socket binds.
Tools are listed with
`mcp_ping` and `terminate_current_run` first, then the rest alphabetically.

## Call layering

[`service.rs`](../../studio/src-tauri/crates/surfaces/ticketry-mcp/src/service.rs)
`call_tool` runs these steps in order for every tool:

1. **Unknown name.** The call fails with JSON-RPC `invalid_params`.
2. **Authorization.** Each connection opens with an authentication envelope
   ([`connection_handshake.rs`](../../studio/src-tauri/crates/surfaces/ticketry-mcp/src/connection_handshake.rs)).
   On a bearer (run) connection, every call is re-authorized through
   `RunAuthority::authorize` against the grant and the per-run policy. A refusal
   comes back as a structured result such as
   `reason: "authorization_tool_disallowed"`. A global connection (no bearer)
   runs as `RunPrincipal::global()`. The exception is a **run-only** tool
   (`TypedTool::run_only()`: `terminate_current_run`, `get_sprint_goals` and
   `suggest_sprint_story`): it goes through authorization anyway and is refused
   with `{ok:false, error:"caller_run_unbound", reason:"authorization_missing"}`
   before any argument is read. `RunAuthority` still lets an ended run call
   `terminate_current_run`.
3. **Readiness-exempt tools** (`TypedTool::readiness_exempt()`, which today is
   only `mcp_ping`) answer at this point.
4. **Readiness gate.** While `slice2-readiness.json` is present and incomplete,
   the call returns `{ok:false, code:"service_unavailable", phase:"runtime-reconciliation", …}`.
5. **Parsing and handling.** The tool parses its arguments, then runs its
   handler.

Domain scope checks stay inside handlers. These are
[`scope.rs`](../../studio/src-tauri/crates/surfaces/ticketry-mcp/src/scope.rs)
`project`, `task`, `module_id` and `issue_type`, which return `foreign_scope`
and `not_found`. Writes go through the existing work-management commands.
Routing adds no business rules. The workflow-policy tools register through one
`policy_tool` constructor whose parameter types implement `IssueTypeScoped`, so
each of them checks `scope::issue_type` before its write and answers with the
type's refreshed workflow settings; no check depends on the tool name.

## Adding a tool: typed parameters, a handler and a description

```rust
#[derive(Deserialize, JsonSchema)]
#[schemars(crate = "rmcp::schemars")]
struct TaskReference {
    id_or_key: String,
}

TypedTools::default().with(TypedTool::new(
    "get_task_details",
    "Get detailed information about a specific task using its ID or Key (e.g. PROJ-123).",
    |call, TaskReference { id_or_key }| async move {
        let task = scope::task(&call.database, &call.principal, &id_or_key).await?;
        Ok(projection::task_details(&call.database, &task).await)
    },
)
.answers_under_result())
```

That is the whole change. `ToolSurface::build` already merges the module's
`TypedTools`, so `tools/list`, `allowed_provider_operations()` (and with it
every launched run's grant) and the provider-mutation check all see the new
tool without further edits. A new capability module adds one `merge` line in
`ToolSurface::build`. Only a tool that writes outside every Ticketry table —
a provider-owned mutation that generated CRUD cannot serve — also needs a
`PROVIDER_MUTATIONS` record with its evidence in
[`operation_registry.rs`](../../studio/src-tauri/crates/surfaces/ticketry-mcp/src/operation_registry.rs);
startup refuses a record whose tool is missing.

- **Schema.** The published input schema is derived from the parameter type
  (rmcp `schema_for_input`, with `$schema` removed). Use
  `TypedTool::without_parameters` for a tool that takes no arguments; it
  publishes `{"type":"object","properties":{}}` from `NoParameters`. Never
  write a schema by hand.
- **Malformed arguments.** These never become JSON-RPC errors.
  [`argument_rejection.rs`](../../studio/src-tauri/crates/surfaces/ticketry-mcp/src/tool_surface/argument_rejection.rs)
  turns a parse failure into
  `{ok:false, code:"validation", detail, field:"<top-level field>"}`, the
  vocabulary CODING-2726 and CODING-2740 approved for formerly coerced input.
  A `CommandError` from a handler keeps its own code, so a domain refusal of
  well-formed arguments (an unknown `issue_type`, a `null` launch-binding
  `prompt`) is still `field_validation`.
  rmcp's stock `Parameters` extractor would return `invalid_params`, so the
  typed path doesn't use it. Unknown keys follow the parameter type's serde
  policy. The default is to ignore them; `#[serde(deny_unknown_fields)]` is
  for the closed tools.
- **Patch fields** declare
  [`PatchInput<T>`](../../studio/src-tauri/crates/surfaces/ticketry-mcp/src/tool_surface/patch_input.rs)
  with `#[serde(default)]`. A missing key is `Omitted`, `null` is `Null`, and
  anything else is `Value(T)`. Each maps onto work-management `PatchValue`. The
  field publishes the recorded nullable form,
  `{"anyOf":[<T>,{"type":"null"}],"default":null}`.
- **Output.** The handler returns `Result<serde_json::Value, CommandError>`.
  The value is the whole structured result unless the definition declares
  `.answers_under_result()`, which publishes it as `{"result": …}`; keep the
  tool's existing shape. A `CommandError` becomes the shared
  `{ok:false, detail, code, field?, from?, to?}` rejection.
- **Markers.** `.run_only()` and `.readiness_exempt()` add the policies
  described under [Call layering](#call-layering).
- **Provider results.** A provider tool that answers in its own vocabulary
  registers with `TypedTool::with_own_results`: its handler returns the whole
  structured result, and its own function renders malformed arguments from the
  parse failure's `ArgumentError`. `rename_codex_thread` uses it to keep
  `{ok:false, error:"invalid_input", detail}`.

### Inputs the work-item tools tightened (CODING-2742)

Well-formed calls write the same rows as before. These inputs, which used to be
coerced, are now `validation` rejections that name the field:

- `create_review_finding`: a missing, non-integer or non-positive `line_start`
  or `line_end` (previously treated as 0). The command's own evidence checks,
  such as `malformed_range` for `line_end < line_start`, still apply.
- `create_task`/`create_sub_task`: a wrong-typed `module_id` or `state_name`
  (previously ignored), or a `null` or non-string `description`. An omitted
  `description` is the published default `""`, which the command stores for
  none anyway. `create_sub_task` still publishes no `module_id`, and it ignores
  one if it is sent.
- `update_task`: a wrong-typed `name` or `description` (previously ignored).
  `null` still means omitted and never clears a field.
- Missing or wrong-typed required strings on every tool now name the field
  instead of `arguments`. `add_task_tags` keeps its `tags must be an array.`
  and `tags values must be strings.` messages.

### Inputs the workflow-policy tools tightened (CODING-2743)

Well-formed calls write the same rows as before, through the same
revision-guarded `workflow`/`catalog` commands. Now `validation`
rejections that name the field:

- A missing or wrong-typed `type_id`, state id or `workflow_revision`
  (previously `field: "arguments"`). `workflow_revision` publishes
  `{"type":"integer","format":"int32"}` and an out-of-range value names it.
- A `null` or wrong-typed `agent_allowed`, `handoff` or `auto_start` is still
  refused, and now always names its field. `agent_allowed` defaults to `true` and
  `handoff` to `false` on `add_issue_type_workflow_transition`, published from
  the typed definition. On `set_issue_type_workflow_transition_permission` both
  stay optional plain booleans: omitted means unchanged.
- `upsert_issue_type_workflow_launch_binding`: a wrong-typed `agent`
  (previously ignored). `prompt`, `profile`, `model`, `reasoning`,
  `required_skills` and `stage_skills` are `PatchInput` fields. `agent` is
  still optional and `null` still means none; `entry_skill` is not published
  and is ignored.
- `set_issue_type_workflow_start_state` publishes `state_id` as required.

### Inputs the dependency, attachment and launch tools tightened (CODING-2744)

Well-formed calls behave as before, through the same blocker, hierarchy,
attachment, launch policy, graph run and terminal launch services. Now
`validation` rejections that name the field:

- A non-string entry, or a non-array, in `set_task_blockers.blocked_by_ids` or
  `reparent_tasks.task_ids` (previously coerced to `""` and answered
  `not_found`).
- A non-boolean `execute_dependency_graph.reset` (previously `false`).
  Omitted `reset` is still `false`; `agent` is still trimmed, and blank or
  `null` still means no provider override.
- Missing or wrong-typed required strings name the field instead of
  `arguments`.

`reparent_tasks` still publishes and accepts `module_id` (a string or `null`)
and still ignores it: items always take the parent's module. A wrong-typed
`module_id` is now refused. `add_task_dependent` still makes
`dependent_task_id` blocked by `task_id` and answers for the dependent.

### Run-only and provider tools (CODING-2745)

Well-formed calls behave as before. Termination keeps `continued_by_handoff`
and its run-control codes. The sprint tools keep their sprint UUID, project,
open-sprint, issue_id-xor-proposal and per-run suggestion checks.

- **Reviewed refusal change.** A global connection used to reach the sprint
  handlers and fail on its empty project: `not_found`, `foreign_scope` or a
  field rejection, depending on the arguments. The sprint tools are now marked
  run-only, so every global call gets the `authorization_missing` refusal that
  `terminate_current_run` returns.
- **Closed tools.** `get_sprint_goals`, `suggest_sprint_story` and
  `rename_codex_thread` now refuse unknown keys, matching their published
  `additionalProperties:false`. On the sprint tools this is a
  `validation` rejection naming the key. On `rename_codex_thread` it is
  `invalid_input` with `"<key> is not a rename_codex_thread argument."`
- `rename_codex_thread` keeps `"<field> must be a non-blank string."` for a
  missing, `null`, wrong-typed or blank argument, keeps its trimming rules and
  has no database scope.
- Missing or wrong-typed `goal_id`/`reason` on `suggest_sprint_story` name the
  field instead of `arguments`. Its nullable `issue_id`, `proposed_name` and
  `proposed_epic_id` publish `{"type":["string","null"],"default":null}`.

When you add a tool, register a typed handler in its capability module and
review the golden snapshot diff. CODING-2746 changed no published schema: the
snapshot diff across CODING-2741..2746 is exactly the reviewed changes listed
above.

## Test coverage

| Seam | Test |
| --- | --- |
| Published schemas, names, order and descriptions (the single schema contract) | `tool_surface::tests::published_tools_match_the_golden_snapshot` against [`published_tools.golden.json`](../../studio/src-tauri/crates/surfaces/ticketry-mcp/src/tool_surface/published_tools.golden.json). The snapshot is canonical (sorted keys); regenerate with `TICKETRY_UPDATE_MCP_GOLDEN=1` and review the diff as public API. |
| Grant inventory | `tool_surface::tests::provider_operations_are_every_published_tool_plus_lifecycle` |
| Duplicate names | `tool_surface::tests::a_name_published_twice_fails_composition` |
| One registration mechanism | `tool_surface::tests::a_route_without_a_typed_definition_never_reaches_the_surface` and `tool_surface::tests::tools_register_only_through_typed_definitions` |
| Answer shape follows each definition (`{"result": …}` or direct, refusals never wrapped) | `each_tool_answers_in_its_declared_shape` in [`tests/mcp_acceptance/work_item_contracts.rs`](../../studio/src-tauri/tests/mcp_acceptance/work_item_contracts.rs) |
| Three-state patch input | `tool_surface::patch_input::tests` |
| Socket behavior: malformed arguments, unknown keys, global and run connections, disallowed tools, `tools/list` filtering, readiness | [`src/tests/typed_tool_surface.rs`](../../studio/src-tauri/crates/surfaces/ticketry-mcp/src/tests/typed_tool_surface.rs) and the listener suites in `src/tests.rs`, `src/tests/connection_sessions.rs` and `src/tests/socket_lifecycle.rs` |
| Work-item create/update tools: malformed and null arguments | [`src/tests/typed_work_item_tools.rs`](../../studio/src-tauri/crates/surfaces/ticketry-mcp/src/tests/typed_work_item_tools.rs) |
| Work-item create/update tools: default and null arguments write the spelled-out rows, and status-gate refusals keep their shape (full command database) | [`tests/mcp_acceptance/work_item_contracts.rs`](../../studio/src-tauri/tests/mcp_acceptance/work_item_contracts.rs) |
| Workflow-policy tools: issue-type scope on all seven, malformed arguments | [`src/tests/typed_workflow_policy_tools.rs`](../../studio/src-tauri/crates/surfaces/ticketry-mcp/src/tests/typed_workflow_policy_tools.rs) |
| Workflow-policy tools: transition defaults, optional permissions, omitted/null/value for each launch-binding patch field, Codex-only profiles (full command database) | [`tests/mcp_acceptance/workflow_policy_contracts.rs`](../../studio/src-tauri/tests/mcp_acceptance/workflow_policy_contracts.rs) and `mcp_stage_skills_use_the_workflow_list_contract` |
| Dependency, attachment and launch tools: scope on the target and every referenced id, per-item reparent project check, malformed ids and `reset`, output shapes with no launch services, `module_id` accepted and ignored | [`src/tests/typed_dependency_launch_tools.rs`](../../studio/src-tauri/crates/surfaces/ticketry-mcp/src/tests/typed_dependency_launch_tools.rs) and `launch_tools::graph_run_contract_tests` |
| Blockers, reversed `add_task_dependent` edge, reparent and launches (full command database) | `mcp_mutations_cover_crud_hierarchy_workflow_and_blockers_through_rust_commands` in `tests/mcp_acceptance.rs`, and `mcp_kill_failure.rs` |
| Packaged stdio bridge against a disposable listener | [`ticketry-hook/tests/mcp_typed_tools.rs`](../../studio/src-tauri/crates/app/ticketry-hook/tests/mcp_typed_tools.rs) and `mcp_runtime.rs` |
| Run-only refusal on global connections, closed-tool unknown keys, `rename_codex_thread` refusal shape and trimming | [`src/tests/typed_run_only_provider_tools.rs`](../../studio/src-tauri/crates/surfaces/ticketry-mcp/src/tests/typed_run_only_provider_tools.rs) |
| Sprint suggestions, termination and handoff, Codex rename against the resident app-server (full command database) | `tests/mcp_acceptance/{sprint_suggestions,termination,codex_rename}.rs` |
| Provider-mutation exceptions | `operation_registry::tests` |
| Adapters own no SeaORM queries and no backend HTTP path | [`src/tests/adapter_boundaries.rs`](../../studio/src-tauri/crates/surfaces/ticketry-mcp/src/tests/adapter_boundaries.rs) |
| Root acceptance, API boundary and crate tiers | `studio/src-tauri/tests/mcp_acceptance.rs` (+ `mcp_acceptance/`), `mcp_kill_failure.rs`, `public_api_boundary_contract.rs`, `crate_tier_layout.rs` |
| Launch-side MCP configuration | `ticketry-launch` tests (`it::workflow_profile_launch`, `gemini_directory_trust`) |

Run them with:

```bash
cargo test --manifest-path studio/src-tauri/Cargo.toml -p ticketry-mcp -p ticketry-hook -p ticketry-launch
cargo test --manifest-path studio/src-tauri/Cargo.toml --test mcp_acceptance --test mcp_kill_failure \
  --test public_api_boundary_contract --test crate_tier_layout
```

Related docs: [`docs/sprint-suggestion-mcp.md`](../sprint-suggestion-mcp.md) and
[`docs/plans/CODING-1550-mcp-socket-spec.md`](../plans/CODING-1550-mcp-socket-spec.md).

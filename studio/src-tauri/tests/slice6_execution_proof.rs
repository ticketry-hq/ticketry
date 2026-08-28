//! Slice 6, from the outside: what a request can make the execution authority do.
//!
//! Every case drives the composed desktop runtime over the authored GraphQL
//! contract Studio uses or the in-process MCP listener agents use, and observes
//! only what a caller can see: the result envelope, the durable Graph Run and
//! its launch ledger, the Agent Runs recorded against each child, and the
//! verified runtimes the private tmux server is hosting. Both transports reach
//! one serialized Graph Run service, which is the point.
//!
//! Recovery, restart, adoption, and shutdown are proved in
//! `slice6_execution_recovery`.

mod common;

use common::execution_fixture as fixture;
use common::execution_harness::{public_id, ExecutionHarness};
use sea_orm::{ConnectionTrait, DatabaseConnection, DbBackend, Statement};
use serde_json::{json, Value};

#[tokio::test]
async fn the_factual_graph_read_describes_the_plan_without_arming_it() {
    let mut harness = ExecutionHarness::start().await;
    let graph = harness
        .mcp(
            "get_dependency_graph",
            json!({"root_task_id": fixture::PARALLEL_CAMPAIGN_ROOT}),
        )
        .await;

    assert_eq!(
        graph["root_id"],
        public_id(fixture::PARALLEL_CAMPAIGN_ROOT),
        "{graph}"
    );
    // The plan is the root plus its non-archived descendants, so a grandchild
    // is described even though it can never be a launch candidate.
    assert_eq!(
        node_ids(&graph),
        vec![
            public_id(fixture::PARALLEL_CAMPAIGN_ROOT),
            public_id(fixture::READY_FIRST),
            public_id(fixture::READY_SECOND),
            public_id(fixture::EXTERNALLY_BLOCKED),
            public_id(fixture::GRANDCHILD),
        ],
        "{graph}"
    );
    // Only blocker edges with both endpoints inside the plan are returned, so
    // the outside blocker holding a child is not described as an edge.
    assert!(
        graph["nodes"]
            .as_array()
            .is_some_and(|nodes| nodes.iter().all(|node| node["blocked_by"]
                .as_array()
                .is_some_and(|ids| ids.is_empty()))),
        "{graph}"
    );

    let database = harness.database().await;
    assert_eq!(count(&database, "graph_runs").await, 0);
    assert_eq!(count(&database, "launched_tasks").await, 0);
    harness.shutdown().await;
}

#[tokio::test]
async fn a_factual_graph_read_of_unusable_work_is_refused_with_a_stable_code() {
    let mut harness = ExecutionHarness::start().await;
    let childless = harness
        .mcp(
            "get_dependency_graph",
            json!({"root_task_id": fixture::CHILDLESS_ROOT}),
        )
        .await;
    assert_eq!(childless["error"], "graph_empty", "{childless}");
    let archived = harness
        .mcp(
            "get_dependency_graph",
            json!({"root_task_id": fixture::ARCHIVED_CHILD}),
        )
        .await;
    assert_eq!(archived["error"], "graph_root_archived", "{archived}");
    harness.shutdown().await;
}

#[tokio::test]
async fn a_parallel_press_starts_every_ready_direct_child_exactly_once() {
    let mut harness = ExecutionHarness::start().await;
    let executed = harness.execute(fixture::PARALLEL_CAMPAIGN_ROOT).await;

    // Grandchildren, archived branches, and a child held by an outside blocker
    // are never candidates, and the root's own blocker does not gate them.
    assert_eq!(launched_ids(&executed), ready_children(), "{executed}");
    let database = harness.database().await;
    assert_eq!(claimed_children(&database).await, ready_children());
    assert_eq!(harness.live_runtimes().len(), 2);
    assert_eq!(count_campaign_runs(&database).await, 2);

    // A repeated press finds nothing startable, and says so with an accepted
    // empty result rather than a failure.
    let again = harness.execute(fixture::PARALLEL_CAMPAIGN_ROOT).await;
    assert_eq!(launched_ids(&again), Vec::<String>::new(), "{again}");
    assert!(again.get("error").is_none(), "{again}");
    assert_eq!(harness.live_runtimes().len(), 2);
    assert_eq!(count_campaign_runs(&database).await, 2);
    harness.shutdown().await;
}

#[tokio::test]
async fn a_released_outside_blocker_lets_the_held_child_start_without_another_press() {
    let mut harness = ExecutionHarness::start().await;
    harness.execute(fixture::PARALLEL_CAMPAIGN_ROOT).await;
    assert_eq!(harness.live_runtimes().len(), 2);

    let moved = harness.set_state(fixture::OUTSIDE_BLOCKER, "Done").await;
    assert_eq!(moved["ok"], json!(true), "{moved}");

    // The committed occurrence is only a wake-up: advancement reads durable
    // Work Item facts and starts the child the blocker was holding.
    let report = harness
        .reconciliation()
        .reconcile_work_item(fixture::OUTSIDE_BLOCKER, fixture::CAMPAIGN_PROJECT)
        .await;
    assert_eq!(
        launched_by(&report),
        vec![fixture::EXTERNALLY_BLOCKED.to_owned()],
        "{report:?}"
    );
    assert_eq!(harness.live_runtimes().len(), 3);
    harness.shutdown().await;
}

#[tokio::test]
async fn a_serial_press_keeps_one_child_active_and_advances_on_durable_facts() {
    let mut harness = ExecutionHarness::start().await;
    let armed = harness
        .graphql(CREATE, serial(fixture::SERIAL_CAMPAIGN_ROOT))
        .await;
    assert_eq!(
        prepared(&armed),
        vec![public_id(fixture::SERIAL_FIRST)],
        "{armed}"
    );

    // The frontier is live, so a second press starts nothing at all.
    let held = harness
        .graphql(UPDATE, serial(fixture::SERIAL_CAMPAIGN_ROOT))
        .await;
    assert_eq!(prepared(&held), Vec::<String>::new(), "{held}");
    assert_eq!(harness.live_runtimes().len(), 1);

    // Satisfaction alone does not release the next child while the runtime runs.
    harness.set_state(fixture::SERIAL_FIRST, "Review").await;
    let satisfied = harness
        .reconciliation()
        .reconcile_work_item(fixture::SERIAL_FIRST, fixture::CAMPAIGN_PROJECT)
        .await;
    assert_eq!(
        launched_by(&satisfied),
        Vec::<String>::new(),
        "a live frontier must hold: {satisfied:?}"
    );

    // The durable Terminal outcome clears liveness, and the frontier moves on.
    let database = harness.database().await;
    let first_run = claim_run(&database, fixture::SERIAL_FIRST).await;
    harness.end_runtime(&first_run).await;
    let advanced = harness
        .reconciliation()
        .reconcile_agent_run(&first_run)
        .await;
    assert_eq!(
        launched_by(&advanced),
        vec![fixture::SERIAL_SECOND.to_owned()],
        "{advanced:?}"
    );
    harness.shutdown().await;
}

#[tokio::test]
async fn termination_before_satisfaction_advances_the_same_serial_frontier() {
    let mut harness = ExecutionHarness::start().await;
    harness
        .graphql(CREATE, serial(fixture::SERIAL_CAMPAIGN_ROOT))
        .await;
    let database = harness.database().await;
    let first_run = claim_run(&database, fixture::SERIAL_FIRST).await;

    // Termination arrives first this time, and holds while the child is still
    // unsatisfied.
    harness.end_runtime(&first_run).await;
    let terminated = harness
        .reconciliation()
        .reconcile_agent_run(&first_run)
        .await;
    assert_eq!(
        launched_by(&terminated),
        Vec::<String>::new(),
        "{terminated:?}"
    );

    // The second durable fact clears the frontier, whichever order they arrive.
    harness.set_state(fixture::SERIAL_FIRST, "Review").await;
    let advanced = harness
        .reconciliation()
        .reconcile_work_item(fixture::SERIAL_FIRST, fixture::CAMPAIGN_PROJECT)
        .await;
    assert_eq!(
        launched_by(&advanced),
        vec![fixture::SERIAL_SECOND.to_owned()],
        "{advanced:?}"
    );
    harness.shutdown().await;
}

#[tokio::test]
async fn a_terminated_parallel_child_does_not_advance_its_campaign_by_itself() {
    let mut harness = ExecutionHarness::start().await;
    harness.execute(fixture::PARALLEL_CAMPAIGN_ROOT).await;
    let database = harness.database().await;
    let first_run = claim_run(&database, fixture::READY_FIRST).await;
    harness.end_runtime(&first_run).await;

    let report = harness
        .reconciliation()
        .reconcile_agent_run(&first_run)
        .await;
    assert_eq!(
        launched_by(&report),
        Vec::<String>::new(),
        "parallel scheduling stays dependency-based: {report:?}"
    );
    assert_eq!(count_campaign_runs(&database).await, 2);
    harness.shutdown().await;
}

#[tokio::test]
async fn an_ended_but_unsatisfied_serial_child_stalls_until_a_deliberate_press() {
    let mut harness = ExecutionHarness::start().await;
    harness
        .graphql(CREATE, serial(fixture::SERIAL_CAMPAIGN_ROOT))
        .await;
    let database = harness.database().await;
    let first_run = claim_run(&database, fixture::SERIAL_FIRST).await;
    harness.end_runtime(&first_run).await;

    // Automatic advancement never overwrites a claim, so a stalled child is
    // neither skipped nor silently retried.
    let advanced = harness
        .reconciliation()
        .reconcile_agent_run(&first_run)
        .await;
    assert_eq!(launched_by(&advanced), Vec::<String>::new(), "{advanced:?}");
    assert_eq!(
        claimed_children(&database).await,
        vec![public_id(fixture::SERIAL_FIRST)]
    );

    // A deliberate press retries that same child rather than a later sibling,
    // and reuses its claim under the next generation.
    let before = claim_tuple(&database, fixture::SERIAL_FIRST).await;
    let pressed = harness
        .graphql(UPDATE, serial(fixture::SERIAL_CAMPAIGN_ROOT))
        .await;
    assert_eq!(
        prepared(&pressed),
        vec![public_id(fixture::SERIAL_FIRST)],
        "{pressed}"
    );
    let after = claim_tuple(&database, fixture::SERIAL_FIRST).await;
    // The child keeps its one claim row and is never reassigned; the retry is
    // the next generation of that claim, with its own predetermined identities.
    assert_ne!(
        before.launch_effect_id, after.launch_effect_id,
        "a retry gets its own predetermined effect"
    );
    assert_ne!(before.claim_id, after.claim_id);
    assert_ne!(before.agent_run_id, after.agent_run_id);
    assert_eq!(after.generation, before.generation + 1);
    assert_eq!(
        claimed_children(&database).await,
        vec![public_id(fixture::SERIAL_FIRST)]
    );
    harness.shutdown().await;
}

#[tokio::test]
async fn a_press_preserves_unrelated_launch_facts_in_the_same_campaign() {
    let mut harness = ExecutionHarness::start().await;
    harness.execute(fixture::PARALLEL_CAMPAIGN_ROOT).await;
    let database = harness.database().await;
    let untouched = claim_tuple(&database, fixture::READY_SECOND).await;

    // Retry the first child only; the sibling's launch history must survive.
    let first_run = claim_run(&database, fixture::READY_FIRST).await;
    harness.end_runtime(&first_run).await;
    let pressed = harness.execute(fixture::PARALLEL_CAMPAIGN_ROOT).await;
    assert_eq!(
        launched_ids(&pressed),
        vec![public_id(fixture::READY_FIRST)],
        "{pressed}"
    );

    assert_eq!(
        claim_tuple(&database, fixture::READY_SECOND).await,
        untouched
    );
    harness.shutdown().await;
}

#[tokio::test]
async fn the_studio_contract_refreshes_mode_and_policy_for_work_that_has_not_started() {
    let mut harness = ExecutionHarness::start().await;
    harness.execute(fixture::PARALLEL_CAMPAIGN_ROOT).await;
    let database = harness.database().await;
    assert_eq!(
        mode(&database, fixture::PARALLEL_CAMPAIGN_ROOT).await,
        "parallel"
    );
    let started = claim_tuple(&database, fixture::READY_FIRST).await;

    // Studio presses the same campaign with its newest choice. Both children
    // are live, so the press starts nothing and only refreshes the header.
    let pressed = harness
        .graphql(UPDATE, serial(fixture::PARALLEL_CAMPAIGN_ROOT))
        .await;
    assert_eq!(
        pressed["data"]["graph_run_result"]["graph_run"]["execution_mode"], "serial",
        "{pressed}"
    );
    assert_eq!(prepared(&pressed), Vec::<String>::new(), "{pressed}");
    assert_eq!(
        mode(&database, fixture::PARALLEL_CAMPAIGN_ROOT).await,
        "serial"
    );
    assert!(policy_snapshot(&database, fixture::PARALLEL_CAMPAIGN_ROOT)
        .await
        .is_some());
    // Already started children keep the configuration they launched under.
    assert_eq!(claim_tuple(&database, fixture::READY_FIRST).await, started);
    harness.shutdown().await;
}

#[tokio::test]
async fn the_studio_contract_resets_the_ledger_without_starting_or_ending_work() {
    let mut harness = ExecutionHarness::start().await;
    harness.execute(fixture::PARALLEL_CAMPAIGN_ROOT).await;
    let database = harness.database().await;
    let runs_before = count_campaign_runs(&database).await;
    let live_before = harness.live_runtimes();

    let reset = harness
        .graphql(DELETE, json!({"rootId": fixture::PARALLEL_CAMPAIGN_ROOT}))
        .await;
    assert_eq!(cleared(&reset), ready_children(), "{reset}");
    assert_eq!(count(&database, "graph_runs").await, 0);
    assert_eq!(count(&database, "launched_tasks").await, 0);
    // Reset is administrative: the agents it forgets keep running.
    assert_eq!(count_campaign_runs(&database).await, runs_before);
    assert_eq!(harness.live_runtimes(), live_before);
    assert_eq!(
        count_where(&database, "agent_runs", "ended_at IS NOT NULL").await,
        0
    );

    // A campaign the reset forgot is unarmed again, and the live children it
    // forgot are still left alone.
    let unarmed = harness
        .graphql(UPDATE, parallel(fixture::PARALLEL_CAMPAIGN_ROOT))
        .await;
    assert_eq!(error_code(&unarmed), "graph_run_not_found", "{unarmed}");
    let rearmed = harness.execute(fixture::PARALLEL_CAMPAIGN_ROOT).await;
    assert_eq!(launched_ids(&rearmed), Vec::<String>::new(), "{rearmed}");
    assert_eq!(harness.live_runtimes(), live_before);
    harness.shutdown().await;
}

#[tokio::test]
async fn rejections_are_stable_coded_and_leave_no_partial_campaign() {
    let mut harness = ExecutionHarness::start().await;
    let database = harness.database().await;

    for (label, variables, expected) in [
        (
            "empty graph",
            parallel(fixture::CHILDLESS_ROOT),
            "graph_empty",
        ),
        (
            "unknown root",
            parallel("00000000000000000000000000000001"),
            "task_not_found",
        ),
        (
            "archived root",
            parallel(fixture::ARCHIVED_CHILD),
            "graph_root_archived",
        ),
        (
            "invalid mode",
            json!({"rootId": fixture::PARALLEL_CAMPAIGN_ROOT, "executionMode": "recursive"}),
            "graph_run_invalid_mode",
        ),
    ] {
        let refused = harness.graphql(CREATE, variables).await;
        assert_eq!(error_code(&refused), expected, "{label}: {refused}");
    }

    // A press on a root that was never armed is not an update.
    let unarmed = harness
        .graphql(UPDATE, parallel(fixture::SERIAL_CAMPAIGN_ROOT))
        .await;
    assert_eq!(error_code(&unarmed), "graph_run_not_found", "{unarmed}");

    assert_eq!(count(&database, "graph_runs").await, 0);
    assert_eq!(count(&database, "launched_tasks").await, 0);
    assert_eq!(count_campaign_runs(&database).await, 0);
    assert!(harness.live_runtimes().is_empty());
    harness.shutdown().await;
}

#[tokio::test]
async fn results_and_errors_omit_prompts_paths_commands_and_runtime_identity() {
    let mut harness = ExecutionHarness::start().await;
    let executed = harness.execute(fixture::PARALLEL_CAMPAIGN_ROOT).await;
    let refused = harness
        .graphql(CREATE, parallel(fixture::CHILDLESS_ROOT))
        .await;
    let pressed = harness
        .graphql(UPDATE, serial(fixture::PARALLEL_CAMPAIGN_ROOT))
        .await;
    let holding = harness
        .graphql(HOLDING, json!({"rootId": fixture::PARALLEL_CAMPAIGN_ROOT}))
        .await;

    for observed in [&executed, &refused, &pressed, &holding] {
        let rendered = observed.to_string();
        for secret in [
            "Implement the slice.",
            "launchConfiguration",
            "launch_configuration",
            "agent_run_id",
            "launch_effect_id",
            "tmux",
            "pt-",
            "codex",
            harness.data_directory().to_string_lossy().as_ref(),
        ] {
            assert!(!rendered.contains(secret), "leaked {secret}: {rendered}");
        }
    }
    harness.shutdown().await;
}

#[tokio::test]
async fn mcp_reset_and_execute_uses_the_same_serialized_service_as_the_studio_contract() {
    let mut harness = ExecutionHarness::start().await;
    harness.execute(fixture::PARALLEL_CAMPAIGN_ROOT).await;
    let database = harness.database().await;

    // Reset-and-execute clears the ledger through the same serialized reset,
    // then re-presses. The children it forgot are still live, so nothing is
    // relaunched beside them.
    let compatibility = harness
        .mcp(
            "execute_dependency_graph",
            json!({"root_task_id": fixture::PARALLEL_CAMPAIGN_ROOT, "reset": true}),
        )
        .await;
    assert_eq!(
        launched_ids(&compatibility),
        Vec::<String>::new(),
        "{compatibility}"
    );
    assert_eq!(count(&database, "launched_tasks").await, 0);
    assert_eq!(count(&database, "graph_runs").await, 1);
    assert_eq!(count_campaign_runs(&database).await, 2);

    // Once those runtimes end while the children remain unsatisfied, the same
    // compatibility request re-arms them. A reset does not end an Agent Run, so
    // re-arming replays the generation it forgot: the same predetermined launch
    // tuple is validated and reused rather than a second agent being created
    // for one child.
    let before = [
        agent_run_for(&database, fixture::READY_FIRST).await,
        agent_run_for(&database, fixture::READY_SECOND).await,
    ];
    for run in &before {
        harness.end_runtime(run).await;
    }
    let rearmed = harness
        .mcp(
            "execute_dependency_graph",
            json!({"root_task_id": fixture::PARALLEL_CAMPAIGN_ROOT, "reset": true}),
        )
        .await;
    assert_eq!(launched_ids(&rearmed), ready_children(), "{rearmed}");
    assert_eq!(count_campaign_runs(&database).await, 2);
    assert_eq!(
        [
            agent_run_for(&database, fixture::READY_FIRST).await,
            agent_run_for(&database, fixture::READY_SECOND).await,
        ],
        before
    );
    assert_eq!(claimed_children(&database).await, ready_children());
    harness.shutdown().await;
}

#[tokio::test]
async fn every_graph_read_and_mutation_is_scoped_to_the_callers_project() {
    let mut harness = ExecutionHarness::start().await;
    harness
        .authorization()
        .bind_to_project(fixture::FOREIGN_PROJECT, fixture::FOREIGN_ROOT);

    let read = harness
        .mcp(
            "get_dependency_graph",
            json!({"root_task_id": fixture::PARALLEL_CAMPAIGN_ROOT}),
        )
        .await;
    assert_eq!(read["code"], "foreign_scope", "{read}");
    let executed = harness.execute(fixture::PARALLEL_CAMPAIGN_ROOT).await;
    assert_eq!(executed["code"], "foreign_scope", "{executed}");

    let database = harness.database().await;
    assert_eq!(count(&database, "graph_runs").await, 0);
    assert!(harness.live_runtimes().is_empty());
    harness.shutdown().await;
}

const CREATE: &str = r#"
mutation Create($rootId: String!, $executionMode: String) {
  graph_run_result: graph_run_create(root_id: $rootId, execution_mode: $executionMode) {
    graph_run { root_id: rootId execution_mode: executionMode }
    prepared: prepared_child_ids
  }
}
"#;

const UPDATE: &str = r#"
mutation Update($rootId: String!, $executionMode: String) {
  graph_run_result: graph_run_update(root_id: $rootId, execution_mode: $executionMode) {
    graph_run { root_id: rootId execution_mode: executionMode }
    prepared: prepared_child_ids
  }
}
"#;

const DELETE: &str = r#"
mutation Delete($rootId: String!) {
  graph_run_result: graph_run_delete(root_id: $rootId) {
    graph_run { root_id: rootId }
    cleared: cleared_child_ids
  }
}
"#;

/// The holding Studio reads before deciding whether a press is a create or an
/// update, exactly as its generated operation does.
const HOLDING: &str = r#"
query Holding($rootId: String!) {
  graph_run_holding: graphRuns(
    filters: { rootId: { eq: $rootId } }
    pagination: { offset: { limit: 1, offset: 0 } }
  ) {
    nodes { root_id: rootId execution_mode: executionMode }
  }
}
"#;

fn serial(root_id: &str) -> Value {
    json!({"rootId": root_id, "executionMode": "serial"})
}

fn parallel(root_id: &str) -> Value {
    json!({"rootId": root_id, "executionMode": null})
}

fn ready_children() -> Vec<String> {
    vec![
        public_id(fixture::READY_FIRST),
        public_id(fixture::READY_SECOND),
    ]
}

fn prepared(response: &Value) -> Vec<String> {
    string_list(&response["data"]["graph_run_result"]["prepared"], response)
}

fn cleared(response: &Value) -> Vec<String> {
    string_list(&response["data"]["graph_run_result"]["cleared"], response)
}

fn launched_ids(response: &Value) -> Vec<String> {
    string_list(&response["launched"], response)
}

fn string_list(value: &Value, context: &Value) -> Vec<String> {
    value
        .as_array()
        .unwrap_or_else(|| panic!("expected an identity list: {context}"))
        .iter()
        .map(|value| value.as_str().unwrap_or_default().to_owned())
        .collect()
}

fn launched_by(
    report: &muxed_studio_lib::execution::reconciliation::ExecutionReconciliationReport,
) -> Vec<String> {
    let mut launched = report
        .roots
        .iter()
        .flat_map(|root| root.launched_task_ids.clone())
        .collect::<Vec<_>>();
    launched.sort();
    launched
}

fn error_code(response: &Value) -> String {
    response["errors"][0]["extensions"]["code"]
        .as_str()
        .unwrap_or_else(|| panic!("a refusal carries a stable code: {response}"))
        .to_owned()
}

fn node_ids(graph: &Value) -> Vec<String> {
    graph["nodes"]
        .as_array()
        .unwrap_or_else(|| panic!("a factual graph read carries nodes: {graph}"))
        .iter()
        .map(|node| node["id"].as_str().unwrap_or_default().to_owned())
        .collect()
}

#[derive(Debug, Eq, PartialEq)]
struct ClaimFacts {
    claim_id: String,
    agent_run_id: String,
    launch_effect_id: String,
    generation: i64,
}

async fn claimed_children(database: &DatabaseConnection) -> Vec<String> {
    rows(
        database,
        "SELECT task_id FROM launched_tasks ORDER BY task_id",
    )
    .await
    .into_iter()
    .map(|id| public_id(&id))
    .collect()
}

async fn claim_run(database: &DatabaseConnection, task_id: &str) -> String {
    claim_tuple(database, task_id).await.agent_run_id
}

/// The newest Agent Run recorded against a Work Item, whether or not the
/// campaign still remembers it.
async fn agent_run_for(database: &DatabaseConnection, task_id: &str) -> String {
    rows(
        database,
        &format!("SELECT id FROM agent_runs WHERE issue_id='{task_id}' ORDER BY started_at DESC"),
    )
    .await
    .into_iter()
    .next()
    .unwrap_or_else(|| panic!("{task_id} has an Agent Run"))
}

async fn claim_tuple(database: &DatabaseConnection, task_id: &str) -> ClaimFacts {
    let row = database
        .query_one_raw(Statement::from_string(
            DbBackend::Sqlite,
            format!("SELECT claim_id, agent_run_id, launch_effect_id, launch_generation FROM launched_tasks WHERE task_id='{task_id}'"),
        ))
        .await
        .expect("read the campaign claim")
        .unwrap_or_else(|| panic!("{task_id} has a campaign claim"));
    ClaimFacts {
        claim_id: row.try_get("", "claim_id").unwrap(),
        agent_run_id: row.try_get("", "agent_run_id").unwrap(),
        launch_effect_id: row.try_get("", "launch_effect_id").unwrap(),
        generation: row.try_get("", "launch_generation").unwrap(),
    }
}

async fn mode(database: &DatabaseConnection, root_id: &str) -> String {
    rows(
        database,
        &format!("SELECT execution_mode FROM graph_runs WHERE root_id='{root_id}'"),
    )
    .await
    .pop()
    .unwrap_or_else(|| panic!("{root_id} is armed"))
}

async fn policy_snapshot(database: &DatabaseConnection, root_id: &str) -> Option<String> {
    rows(
        database,
        &format!("SELECT launch_configuration FROM graph_runs WHERE root_id='{root_id}'"),
    )
    .await
    .pop()
}

async fn rows(database: &DatabaseConnection, query: &str) -> Vec<String> {
    database
        .query_all_raw(Statement::from_string(DbBackend::Sqlite, query.to_owned()))
        .await
        .expect("read durable execution facts")
        .into_iter()
        .filter_map(|row| row.try_get_by_index::<Option<String>>(0).ok().flatten())
        .collect()
}

async fn count(database: &DatabaseConnection, table: &str) -> i64 {
    scalar(database, &format!("SELECT COUNT(*) FROM {table}")).await
}

/// The active harness principal authenticates MCP but is not a campaign launch.
async fn count_campaign_runs(database: &DatabaseConnection) -> i64 {
    scalar(
        database,
        &format!(
            "SELECT COUNT(*) FROM agent_runs WHERE id<>'{}'",
            common::execution_authorization::CALLER_RUN_ID
        ),
    )
    .await
}

async fn count_where(database: &DatabaseConnection, table: &str, predicate: &str) -> i64 {
    scalar(
        database,
        &format!("SELECT COUNT(*) FROM {table} WHERE {predicate}"),
    )
    .await
}

async fn scalar(database: &DatabaseConnection, query: &str) -> i64 {
    database
        .query_one_raw(Statement::from_string(DbBackend::Sqlite, query.to_owned()))
        .await
        .expect("read a durable count")
        .expect("SQLite returns one row")
        .try_get_by_index(0)
        .expect("counts are integers")
}

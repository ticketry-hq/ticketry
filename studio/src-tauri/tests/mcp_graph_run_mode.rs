//! The campaign `execute_dependency_graph` arms in each edition (CODING-2859).
//!
//! Pocock runs a dependency graph as a serial campaign; editions that grant
//! parallel subtree runs keep the parallel default. The press goes over the
//! composed runtime's real MCP socket, so registry, dispatch and the Graph Run
//! service are the shipped ones.

mod common;

use common::execution_fixture as fixture;
use common::execution_harness::{public_id, ExecutionHarness};
use sea_orm::{ConnectionTrait, DbBackend, Statement};
use ticketry_edition::{has, EditionCapability};

#[tokio::test]
async fn execute_dependency_graph_arms_serial_unless_the_edition_runs_subtrees_in_parallel() {
    let mut harness = ExecutionHarness::start().await;
    let executed = harness.execute(fixture::PARALLEL_CAMPAIGN_ROOT).await;

    let parallel = has(EditionCapability::ParallelSubtreeRuns);
    let launched: Vec<&str> = executed["launched"]
        .as_array()
        .unwrap_or_else(|| panic!("press failed: {executed}"))
        .iter()
        .map(|id| id.as_str().unwrap())
        .collect();
    let first = public_id(fixture::READY_FIRST);
    let second = public_id(fixture::READY_SECOND);
    if parallel {
        assert_eq!(launched, [first.as_str(), second.as_str()], "{executed}");
    } else {
        // A serial campaign starts only its first ready child.
        assert_eq!(launched, [first.as_str()], "{executed}");
    }

    let database = harness.database().await;
    let mode = database
        .query_one_raw(Statement::from_string(
            DbBackend::Sqlite,
            format!(
                "SELECT execution_mode FROM graph_runs WHERE root_id = '{}'",
                fixture::PARALLEL_CAMPAIGN_ROOT
            ),
        ))
        .await
        .unwrap()
        .expect("the press armed a Graph Run")
        .try_get::<String>("", "execution_mode")
        .unwrap();
    assert_eq!(mode, if parallel { "parallel" } else { "serial" });
    harness.shutdown().await;
}

//! Verify campaign adoption and restart stability on a private data copy.
//!
//! Slice 6 adds nothing to the durable authority except Graph Runs and their
//! per-task launch ledger, so this is the evidence a real installation's data
//! survives: classify the source, adopt twice, and prove the campaign identity
//! digest, row counts, and armed work did not move between opens.

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

use sea_orm::{ConnectionTrait, Database, DbBackend, Statement};
use serde::Serialize;

#[derive(Serialize)]
struct Verification {
    version: i32,
    source: String,
    graph_run_rows: i64,
    launch_claim_rows: i64,
    policy_receipt_rows: i64,
    armed_roots_by_mode: BTreeMap<String, u64>,
    active_claim_rows: u64,
    campaign_identity_digest_stable: bool,
    repeatable_after_restart: bool,
}

#[tokio::main]
async fn main() {
    let data_directory = private_copy_argument();
    let (first, source) = adopt(&data_directory, "first").await;
    let (armed_roots_by_mode, active_claim_rows) = campaign_evidence(&data_directory).await;

    let (second, _) = adopt(&data_directory, "restart").await;
    if first.tables != second.tables {
        fail("campaign identity evidence changed after restart adoption");
    }

    println!(
        "{}",
        serde_json::to_string_pretty(&Verification {
            version: second.version,
            source,
            graph_run_rows: rows(&second, "graph_runs"),
            launch_claim_rows: rows(&second, "launched_tasks"),
            policy_receipt_rows: rows(&second, "launch_policy_effects"),
            armed_roots_by_mode,
            active_claim_rows,
            campaign_identity_digest_stable: true,
            repeatable_after_restart: true,
        })
        .expect("verification result is serializable")
    );
}

fn rows(evidence: &muxed_studio_lib::execution::persistence::AdoptionEvidence, table: &str) -> i64 {
    evidence
        .tables
        .get(table)
        .map(|table| table.row_count)
        .unwrap_or_default()
}

fn private_copy_argument() -> PathBuf {
    let mut arguments = std::env::args_os().skip(1);
    let Some(data_directory) = arguments.next().map(PathBuf::from) else {
        fail("usage: verify_slice6_copy <private-data-directory-copy>");
    };
    if arguments.next().is_some() || !data_directory.is_absolute() {
        fail("verify_slice6_copy requires one absolute private data-directory path");
    }
    let supplied = data_directory
        .canonicalize()
        .unwrap_or_else(|_| fail("could not resolve the supplied data directory"));
    let established = ticketry_data_directory::established_data_directory()
        .unwrap_or_else(|_| fail("could not resolve the established data directory"));
    let established = established.canonicalize().unwrap_or(established);
    if supplied == established {
        fail("refusing to adopt the established Ticketry data directory; pass a private copy");
    }
    if !supplied.join("state.db").is_file() {
        fail("the private data-directory copy has no state.db");
    }
    supplied
}

/// Campaign adoption depends on adopted Work Management, Runs, and Terminal
/// identities, so this runs them in the order startup does before classifying
/// and adopting the execution generation.
async fn adopt(
    data_directory: &Path,
    pass: &str,
) -> (
    muxed_studio_lib::execution::persistence::AdoptionEvidence,
    String,
) {
    ticketry_runs::persistence::preflight(data_directory)
        .await
        .unwrap_or_else(|error| fail(&format!("{pass} Runs adoption preflight failed: {error}")));
    ticketry_runs::persistence::adopt(data_directory)
        .await
        .unwrap_or_else(|error| fail(&format!("{pass} Runs adoption failed: {error}")));
    ticketry_terminal::terminal::persistence::preflight(data_directory)
        .await
        .unwrap_or_else(|error| {
            fail(&format!(
                "{pass} Terminal adoption preflight failed: {error}"
            ))
        });
    ticketry_terminal::terminal::persistence::adopt(data_directory)
        .await
        .unwrap_or_else(|error| fail(&format!("{pass} Terminal adoption failed: {error}")));
    let source = muxed_studio_lib::execution::persistence::preflight(data_directory)
        .await
        .unwrap_or_else(|error| {
            fail(&format!(
                "{pass} Execution adoption preflight failed: {error}"
            ))
        });
    let evidence = muxed_studio_lib::execution::persistence::adopt(data_directory)
        .await
        .unwrap_or_else(|error| fail(&format!("{pass} Execution adoption failed: {error}")));
    (
        evidence,
        serde_json::to_string(&source).unwrap_or_else(|_| fail("source classification is opaque")),
    )
}

/// What the copy still has armed, so a restart can be checked for continuing
/// the same campaigns rather than merely opening.
async fn campaign_evidence(data_directory: &Path) -> (BTreeMap<String, u64>, u64) {
    let database = Database::connect(format!(
        "sqlite:{}?mode=ro",
        data_directory.join("state.db").display()
    ))
    .await
    .unwrap_or_else(|_| fail("could not reopen the copied database read-only"));
    let modes = database
        .query_all_raw(Statement::from_string(
            DbBackend::Sqlite,
            "SELECT execution_mode, COUNT(*) AS count FROM graph_runs \
             GROUP BY execution_mode ORDER BY execution_mode"
                .to_owned(),
        ))
        .await
        .unwrap_or_else(|_| fail("could not read copied Graph Run evidence"))
        .into_iter()
        .map(|row| {
            let mode = row
                .try_get::<String>("", "execution_mode")
                .unwrap_or_else(|_| fail("copied Graph Run mode is unreadable"));
            let count = row
                .try_get::<i64>("", "count")
                .unwrap_or_else(|_| fail("copied Graph Run count is unreadable"));
            (mode, count as u64)
        })
        .collect::<BTreeMap<_, _>>();
    let active = database
        .query_one_raw(Statement::from_string(
            DbBackend::Sqlite,
            "SELECT COUNT(*) AS count FROM launched_tasks claim \
             JOIN agent_runs run ON run.id = claim.agent_run_id \
             WHERE run.ended_at IS NULL"
                .to_owned(),
        ))
        .await
        .unwrap_or_else(|_| fail("could not read copied active campaign claims"))
        .unwrap_or_else(|| fail("copied active campaign claim count returned no row"))
        .try_get::<i64>("", "count")
        .unwrap_or_else(|_| fail("copied active campaign claim count is unreadable"));
    database
        .close()
        .await
        .unwrap_or_else(|_| fail("could not close the copied database"));
    (modes, active as u64)
}

fn fail(message: &str) -> ! {
    eprintln!("Slice 6 copy verification failed: {message}");
    std::process::exit(1)
}

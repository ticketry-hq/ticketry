//! Verify terminal adoption and restart stability on a private data copy.

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

use sea_orm::{ConnectionTrait, Database, DbBackend, Statement};
use serde::Serialize;

#[derive(Serialize)]
struct Verification {
    version: i32,
    terminal_rows: u64,
    active_terminal_rows: u64,
    active_scopes: BTreeMap<String, u64>,
    terminal_identity_digest_stable: bool,
    repeatable_after_restart: bool,
}

#[tokio::main]
async fn main() {
    let data_directory = private_copy_argument();
    let first = adopt(&data_directory, "first").await;
    let first_sessions = first
        .tables
        .get("agent_terminal_sessions")
        .unwrap_or_else(|| fail("first adoption omitted Terminal Session evidence"));
    let (active_terminal_rows, active_scopes) = active_scope_evidence(&data_directory).await;

    let second = adopt(&data_directory, "restart").await;
    let second_sessions = second
        .tables
        .get("agent_terminal_sessions")
        .unwrap_or_else(|| fail("restart adoption omitted Terminal Session evidence"));
    if first_sessions != second_sessions {
        fail("Terminal Session identity evidence changed after restart adoption");
    }

    println!(
        "{}",
        serde_json::to_string_pretty(&Verification {
            version: second.version,
            terminal_rows: second_sessions.row_count,
            active_terminal_rows,
            active_scopes,
            terminal_identity_digest_stable: true,
            repeatable_after_restart: true,
        })
        .expect("verification result is serializable")
    );
}

fn private_copy_argument() -> PathBuf {
    let mut arguments = std::env::args_os().skip(1);
    let Some(data_directory) = arguments.next().map(PathBuf::from) else {
        fail("usage: verify_slice5_copy <private-data-directory-copy>");
    };
    if arguments.next().is_some() || !data_directory.is_absolute() {
        fail("verify_slice5_copy requires one absolute private data-directory path");
    }
    let supplied = data_directory
        .canonicalize()
        .unwrap_or_else(|_| fail("could not resolve the supplied data directory"));
    let established = muxed_studio_lib::data_directory::established_data_directory()
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

async fn adopt(
    data_directory: &Path,
    pass: &str,
) -> muxed_studio_lib::terminal_persistence::AdoptionEvidence {
    muxed_studio_lib::runs_persistence::preflight(data_directory)
        .await
        .unwrap_or_else(|error| fail(&format!("{pass} Runs adoption preflight failed: {error}")));
    muxed_studio_lib::runs_persistence::adopt(data_directory)
        .await
        .unwrap_or_else(|error| fail(&format!("{pass} Runs adoption failed: {error}")));
    muxed_studio_lib::terminal_persistence::preflight(data_directory)
        .await
        .unwrap_or_else(|error| {
            fail(&format!(
                "{pass} Terminal adoption preflight failed: {error}"
            ))
        });
    muxed_studio_lib::terminal_persistence::adopt(data_directory)
        .await
        .unwrap_or_else(|error| {
            fail(&format!(
                "{pass} Terminal adoption verification failed: {error}"
            ))
        })
}

async fn active_scope_evidence(data_directory: &Path) -> (u64, BTreeMap<String, u64>) {
    let database = Database::connect(format!(
        "sqlite:{}?mode=ro",
        data_directory.join("state.db").display()
    ))
    .await
    .unwrap_or_else(|_| fail("could not reopen the copied database read-only"));
    let rows = database
        .query_all_raw(Statement::from_string(
            DbBackend::Sqlite,
            "SELECT scope, COUNT(*) AS count FROM agent_terminal_sessions \
             WHERE terminated_at IS NULL GROUP BY scope ORDER BY scope"
                .to_owned(),
        ))
        .await
        .unwrap_or_else(|_| fail("could not read copied active Terminal Session evidence"));
    let scopes = rows
        .into_iter()
        .map(|row| {
            let scope = row
                .try_get::<String>("", "scope")
                .unwrap_or_else(|_| fail("copied Terminal Session scope is unreadable"));
            let count = row
                .try_get::<i64>("", "count")
                .unwrap_or_else(|_| fail("copied Terminal Session count is unreadable"));
            (scope, count as u64)
        })
        .collect::<BTreeMap<_, _>>();
    let count = scopes.values().sum();
    database
        .close()
        .await
        .unwrap_or_else(|_| fail("could not close the copied database"));
    (count, scopes)
}

fn fail(message: &str) -> ! {
    eprintln!("Slice 5 copy verification failed: {message}");
    std::process::exit(1)
}

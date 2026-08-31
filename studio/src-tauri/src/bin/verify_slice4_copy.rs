//! Adopt a private copy of a production-shaped data directory twice.
//!
//! This operator tool deliberately accepts only a data-directory copy. It does
//! not create the copy and never points itself at Ticketry's established data
//! directory, so the first Slice 4 dogfood pass cannot accidentally move the
//! live installation's write lease.

use std::path::PathBuf;

use serde::Serialize;

#[derive(Serialize)]
struct Verification {
    version: i32,
    document_rows: u64,
    worktree_rows: u64,
    ownership_validated: bool,
    repeatable_after_restart: bool,
}

#[tokio::main]
async fn main() {
    let mut arguments = std::env::args_os().skip(1);
    let Some(data_directory) = arguments.next().map(PathBuf::from) else {
        fail("usage: verify_slice4_copy <private-data-directory-copy>");
    };
    if arguments.next().is_some() || !data_directory.is_absolute() {
        fail("verify_slice4_copy requires one absolute private data-directory path");
    }
    let established =
        ticketry_data_directory::established_data_directory().unwrap_or_else(|error| {
            fail(&format!(
                "could not resolve the established data directory: {error}"
            ))
        });
    let supplied = data_directory.canonicalize().unwrap_or_else(|error| {
        fail(&format!(
            "could not resolve the supplied data directory: {error}"
        ))
    });
    let established = established.canonicalize().unwrap_or(established);
    if supplied == established {
        fail("refusing to adopt the established Ticketry data directory; pass a private copy");
    }
    if !supplied.join("state.db").is_file() {
        fail("the private data-directory copy has no state.db");
    }

    let first = muxed_studio_lib::workspace::handoff::adopt(&supplied)
        .await
        .unwrap_or_else(|error| fail(&format!("first Slice 4 adoption failed: {error}")));
    let second = muxed_studio_lib::workspace::handoff::adopt(&supplied)
        .await
        .unwrap_or_else(|error| fail(&format!("restart Slice 4 adoption failed: {error}")));
    if first != second {
        fail("Slice 4 adoption evidence changed on the restart pass");
    }

    let result = Verification {
        version: second.version,
        document_rows: second.document_rows,
        worktree_rows: second.worktree_rows,
        ownership_validated: second.ownership_validated,
        repeatable_after_restart: true,
    };
    println!(
        "{}",
        serde_json::to_string_pretty(&result).expect("verification result is serializable")
    );
}

fn fail(message: &str) -> ! {
    eprintln!("Slice 4 copy verification failed: {message}");
    std::process::exit(1)
}

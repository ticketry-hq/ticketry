//! The tmux adapter owns the persisted session-name contract.
//!
//! Persistence, discovery, cleanup, and lifecycle recovery must all reach that
//! contract through `PersistedSessionName`. These tests pin the derivation and
//! guard the source tree against a second copy of the naming convention.

use std::fs;
use std::path::{Path, PathBuf};

use ticketry_terminal::{
    OwnedSession, PersistedSessionName, TerminalRuntimeIdentity as RuntimeIdentity, SESSION_PREFIX,
};

/// Literal spellings of the naming convention that only the adapter may use.
const LOCAL_DERIVATIONS: [&str; 2] = ["pt-{", "pt-%"];

/// Every directory the naming guard scans: the root package's `src` plus each
/// extracted slice crate's `src`. The adapter itself now lives in
/// `crates/execution/ticketry-terminal`, so scanning only the root package would let a
/// second copy of the convention appear anywhere in the workspace unnoticed.
fn source_roots() -> Vec<PathBuf> {
    let manifest = Path::new(env!("CARGO_MANIFEST_DIR"));
    let mut roots = vec![manifest.join("src")];
    let crates = manifest.join("crates");
    let mut slices: Vec<PathBuf> = fs::read_dir(&crates)
        .expect("readable crates directory")
        .flat_map(|entry| {
            let tier = entry.expect("readable tier entry").path();
            fs::read_dir(&tier)
                .expect("readable tier directory")
                .map(|entry| entry.expect("readable crate entry").path().join("src"))
        })
        .filter(|path| path.is_dir())
        .collect();
    slices.sort();
    assert_eq!(
        slices.len(),
        18,
        "tmux naming guard must scan all workspace crates"
    );
    roots.extend(slices);
    roots
}

fn adapter_owned(path: &Path) -> bool {
    path.components()
        .any(|component| component.as_os_str() == "tmux_adapter")
        || path
            .file_name()
            .is_some_and(|name| name == "tmux_adapter.rs")
}

fn rust_sources(directory: &Path, found: &mut Vec<PathBuf>) {
    for entry in fs::read_dir(directory).expect("readable source directory") {
        let path = entry.expect("readable source entry").path();
        if path.is_dir() {
            rust_sources(&path, found);
        } else if path.extension().is_some_and(|extension| extension == "rs") {
            found.push(path);
        }
    }
}

#[test]
fn persistence_discovery_cleanup_and_lifecycle_share_one_derivation() {
    let identity = RuntimeIdentity::new("agent-run-1", "desktop").unwrap();
    let owned = OwnedSession {
        agent_run_id: "agent-run-1".to_owned(),
        runtime_namespace: "desktop".to_owned(),
        running: true,
        exit_code: None,
    };
    let expected = format!("{SESSION_PREFIX}agent-run-1");

    assert_eq!(
        PersistedSessionName::for_identity(&identity).as_str(),
        expected
    );
    assert_eq!(
        PersistedSessionName::for_owned_session(&owned).as_str(),
        expected
    );
    assert_eq!(
        PersistedSessionName::for_agent_run("agent-run-1")
            .unwrap()
            .into_string(),
        expected
    );
    assert!(PersistedSessionName::records(&expected, "agent-run-1"));
    assert!(!PersistedSessionName::records(
        "pt-agent-run-2",
        "agent-run-1"
    ));
    assert!(PersistedSessionName::for_agent_run("agent run 1").is_err());
}

#[test]
fn no_module_outside_the_adapter_spells_the_session_name_itself() {
    let mut sources = Vec::new();
    for root in source_roots() {
        rust_sources(&root, &mut sources);
    }
    assert!(!sources.is_empty(), "no Rust sources were scanned");

    let offenders = sources
        .iter()
        .filter(|path| !adapter_owned(path))
        .filter_map(|path| {
            let text = fs::read_to_string(path).expect("readable Rust source");
            LOCAL_DERIVATIONS
                .iter()
                .find(|pattern| text.contains(*pattern))
                .map(|pattern| format!("{}: {pattern}", path.display()))
        })
        .collect::<Vec<_>>();

    assert!(
        offenders.is_empty(),
        "derive tmux session names through PersistedSessionName instead: {offenders:?}"
    );
}

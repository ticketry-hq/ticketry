//! Aggregate Seaography audit gate for the Slice 5 terminal subtree.
//!
//! The Story cannot be accepted on a narrative. These tests hold the recorded
//! aggregate evidence against three independent sources of truth: the shipping
//! generated contract, the audited Rust source tree, and the child handoff
//! documents on disk. A new terminal field, a new raw-SQL CRUD path, or a
//! missing child handoff fails here rather than in Review.

use muxed_studio_lib::graphql_foundation::generated_schema_sdl;
use muxed_studio_lib::terminal_persistence::aggregate_seaography_audit::{
    AUDITED_MODULES, CUSTOM_MUTATIONS, CUSTOM_OUTPUTS, CUSTOM_QUERIES, NEEDS_PROOF,
    NON_SEAORM_CRUD_PATHS, RAW_SQL_EVIDENCE_ONLY, REGISTERED_ENTITIES, VERDICT,
};
use muxed_studio_lib::terminal_persistence::child_seaography_handoffs::{
    reconciled_handoffs, CHILD_HANDOFFS,
};
use std::collections::BTreeSet;
use std::path::{Path, PathBuf};

/// `studio/src-tauri`, the crate the audited module paths are relative to.
fn crate_root() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
}

/// The repository root, which the handoff evidence paths are relative to.
fn repository_root() -> PathBuf {
    crate_root()
        .parent()
        .and_then(Path::parent)
        .expect("studio/src-tauri sits two levels below the repository root")
        .to_path_buf()
}

/// The block of one SDL type or root object.
fn sdl_block(sdl: &str, header: &str) -> String {
    let start = sdl
        .find(header)
        .unwrap_or_else(|| panic!("missing SDL block {header}"));
    let rest = &sdl[start..];
    rest[..rest.find("\n}").expect("terminated SDL block")].to_owned()
}

/// Field names declared in one SDL block.
fn field_names(block: &str) -> Vec<String> {
    block
        .lines()
        .skip(1)
        .filter_map(|line| {
            let field = line.trim();
            let name = field.split(['(', ':']).next()?.trim();
            (!name.is_empty()).then(|| name.to_owned())
        })
        .collect()
}

fn mentions_a_terminal_model(field: &str) -> bool {
    let field = field.to_lowercase();
    ["terminal", "viewer_lease", "viewerlease"]
        .iter()
        .any(|marker| field.contains(marker))
}

#[tokio::test]
async fn the_registered_entities_serve_generated_reads_with_private_write_bundles() {
    let sdl = generated_schema_sdl().await.expect("build shipping schema");

    for entity in REGISTERED_ENTITIES {
        assert!(
            sdl.contains(&format!("type {} {{", entity.graphql_type)),
            "{} is not served as a generated read",
            entity.entity
        );
        assert!(
            sdl.contains(&format!("input {}FilterInput {{", entity.graphql_type)),
            "{} lost its generated filter contract",
            entity.entity
        );
        for operation in ["CreateOne", "CreateBatch", "Update", "Delete"] {
            let camel = format!(
                "{}{}",
                entity.graphql_type[..1].to_lowercase() + &entity.graphql_type[1..],
                operation
            );
            assert!(
                !sdl.contains(&camel),
                "{} publishes the generated {operation} write",
                entity.entity
            );
        }
        assert!(
            !sdl.contains(&format!("{}InsertInput", entity.graphql_type)),
            "{} publishes a generated insert input",
            entity.entity
        );
    }
}

#[tokio::test]
async fn the_recorded_custom_fields_are_exactly_the_terminal_fields_in_the_contract() {
    let sdl = generated_schema_sdl().await.expect("build shipping schema");

    let recorded_mutations = CUSTOM_MUTATIONS
        .iter()
        .map(|field| field.field.to_owned())
        .collect::<BTreeSet<_>>();
    let live_mutations = field_names(&sdl_block(&sdl, "type Mutation {"))
        .into_iter()
        .filter(|field| mentions_a_terminal_model(field))
        .collect::<BTreeSet<_>>();
    assert_eq!(
        live_mutations, recorded_mutations,
        "the aggregate record and the live terminal mutation surface diverged"
    );

    let recorded_queries = CUSTOM_QUERIES
        .iter()
        .map(|field| field.field.to_owned())
        .collect::<BTreeSet<_>>();
    let live_custom_queries = field_names(&sdl_block(&sdl, "type Query {"))
        .into_iter()
        // Generated entity reads are camelCase; authored terminal fields are not.
        .filter(|field| mentions_a_terminal_model(field) && field.contains('_'))
        .collect::<BTreeSet<_>>();
    assert_eq!(
        live_custom_queries, recorded_queries,
        "the aggregate record and the live terminal query surface diverged"
    );

    for output in CUSTOM_OUTPUTS {
        assert!(
            sdl.contains(&format!("type {} {{", output.field)),
            "{} is not in the shipping contract",
            output.field
        );
    }
}

#[test]
fn no_audited_module_reaches_model_crud_outside_seaorm() {
    let allowed = RAW_SQL_EVIDENCE_ONLY
        .iter()
        .map(|evidence| crate_root().join(evidence.path))
        .collect::<BTreeSet<_>>();
    let markers = ["sqlx", "rusqlite", "Statement::", "execute_unprepared"];
    let mut offenders = Vec::new();

    for module in AUDITED_MODULES {
        let path = crate_root().join(module);
        assert!(path.exists(), "audited module {module} does not exist");
        for file in rust_sources(&path) {
            if allowed.contains(&file) {
                continue;
            }
            let source = std::fs::read_to_string(&file).expect("read audited source");
            if markers.iter().any(|marker| source.contains(marker)) {
                offenders.push(file);
            }
        }
    }

    assert!(
        offenders.is_empty(),
        "raw database access outside the recorded adoption files: {offenders:?}"
    );
    assert!(NON_SEAORM_CRUD_PATHS.is_empty());
}

#[test]
fn every_reconciled_child_handoff_records_the_parent_required_evidence() {
    let required = [
        "Verdict:",
        "Custom query fields",
        "Custom mutation fields",
        "Ordinary CRUD paths bypassing SeaORM",
        "needs-proof",
    ];

    // Design directories are deliberately local (`.gitignore`), so a clean
    // checkout has no handoff documents to reconcile. Where they do exist,
    // every reconciled child must carry the parent-required evidence.
    let designs = repository_root().join("spec/rusting--cf2de16d");
    if !designs.is_dir() {
        eprintln!("no local design directories; handoff reconciliation not checked");
        return;
    }

    for handoff in reconciled_handoffs() {
        let path = repository_root().join(handoff.evidence);
        let document = std::fs::read_to_string(&path)
            .unwrap_or_else(|_| panic!("{} has no handoff document at {path:?}", handoff.ticket));
        for section in required {
            assert!(
                document.contains(section),
                "{} handoff omits {section}",
                handoff.ticket
            );
        }
        assert!(
            document.contains(handoff.ticket),
            "{} handoff does not name its ticket",
            handoff.ticket
        );
    }
}

#[test]
fn every_child_handoff_checked_real_files() {
    for handoff in CHILD_HANDOFFS {
        for file in handoff.files_checked {
            assert!(
                repository_root().join(file).exists(),
                "{} lists {file}, which does not exist",
                handoff.ticket
            );
        }
    }
}

#[test]
fn the_aggregate_verdict_leaves_review_nothing_to_discover() {
    assert!(VERDICT.contains("no P0 or P1"));
    assert!(
        NEEDS_PROOF.is_empty(),
        "the aggregate audit still has needs-proof items: {NEEDS_PROOF:?}"
    );
}

fn rust_sources(path: &Path) -> Vec<PathBuf> {
    if path.is_file() {
        return vec![path.to_path_buf()];
    }
    let mut sources = Vec::new();
    for entry in std::fs::read_dir(path).expect("read audited module directory") {
        let entry = entry.expect("read audited module entry").path();
        if entry.is_dir() {
            sources.extend(rust_sources(&entry));
        } else if entry.extension().is_some_and(|extension| extension == "rs") {
            sources.push(entry);
        }
    }
    sources
}

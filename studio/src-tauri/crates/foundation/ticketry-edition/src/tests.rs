//! The Rust capability table must say exactly what `config/editions.json` says.

use std::collections::BTreeSet;

use serde_json::Value;

use crate::{has, Edition, EditionCapability, EDITION};

const MANIFEST: &str = include_str!("../../../../../../config/editions.json");

// `has` answers in const context, so later slices can gate items at compile time.
const _: bool = has(EditionCapability::SprintPlanning);

const EDITIONS: [Edition; 2] = [Edition::Pocock, Edition::Core];

fn manifest() -> Value {
    serde_json::from_str(MANIFEST).expect("config/editions.json is valid JSON")
}

fn manifest_capabilities() -> serde_json::Map<String, Value> {
    manifest()["capabilities"]
        .as_object()
        .expect("manifest capabilities is an object")
        .clone()
}

fn manifest_grants(edition: Edition) -> BTreeSet<String> {
    manifest_capabilities()
        .into_iter()
        .filter(|(_, editions)| {
            editions
                .as_array()
                .expect("capability editions is an array")
                .iter()
                .any(|name| name.as_str() == Some(edition.name()))
        })
        .map(|(capability, _)| capability)
        .collect()
}

fn table_grants(edition: Edition) -> BTreeSet<String> {
    EditionCapability::ALL
        .into_iter()
        .filter(|capability| edition.has(*capability))
        .map(|capability| capability.name().to_owned())
        .collect()
}

#[test]
fn manifest_lists_exactly_the_rust_editions_in_order() {
    let manifest = manifest();
    let editions: Vec<&str> = manifest["editions"]
        .as_array()
        .expect("manifest editions is an array")
        .iter()
        .map(|name| name.as_str().expect("edition name is a string"))
        .collect();
    assert_eq!(editions, ["pocock", "core"]);
    let rust: Vec<&str> = EDITIONS.iter().map(|edition| edition.name()).collect();
    assert_eq!(rust, editions);
}

#[test]
fn manifest_capability_keys_equal_the_rust_capabilities() {
    let manifest: BTreeSet<String> = manifest_capabilities().keys().cloned().collect();
    let rust: BTreeSet<String> = EditionCapability::ALL
        .iter()
        .map(|capability| capability.name().to_owned())
        .collect();
    assert_eq!(rust.len(), EditionCapability::ALL.len(), "duplicate name");
    assert_eq!(manifest, rust);
}

#[test]
fn each_edition_grants_exactly_the_manifest_capabilities() {
    for edition in EDITIONS {
        assert_eq!(
            table_grants(edition),
            manifest_grants(edition),
            "{} capabilities drifted from config/editions.json",
            edition.name()
        );
    }
}

#[test]
fn has_answers_for_the_compiled_edition() {
    eprintln!("compiled edition: {}", EDITION.name());
    let core = cfg!(feature = "edition-core");
    let expected = if core { Edition::Core } else { Edition::Pocock };
    assert_eq!(EDITION, expected);
    assert_eq!(has(EditionCapability::SprintPlanning), core);
    assert_eq!(has(EditionCapability::LaunchkeyMidi), core);
    assert_eq!(has(EditionCapability::VoiceTranscription), core);
    assert_eq!(has(EditionCapability::ParallelSubtreeRuns), core);
    assert_eq!(has(EditionCapability::ReviewedWorkflowDefaults), !core);
    for capability in EditionCapability::ALL {
        assert_eq!(has(capability), EDITION.has(capability));
    }
}

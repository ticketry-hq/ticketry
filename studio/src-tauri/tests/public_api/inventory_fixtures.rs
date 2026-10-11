use super::{inventory::Approvals, model::CrateInput, policy, source};
use std::collections::BTreeMap;

fn program(source: &str) -> super::model::Program {
    let directory = tempfile::tempdir().unwrap();
    std::fs::write(directory.path().join("lib.rs"), source).unwrap();
    source::load_crates(&[CrateInput {
        name: "fixture".into(),
        root: directory.path().join("lib.rs"),
        dependencies: BTreeMap::new(),
    }])
}

#[test]
fn literal_named_approvals_require_matching_kind_and_gating_evidence() {
    let approved = Approvals::parse("fixture|run\n", "fixture|run|fn|\n").unwrap();
    assert!(policy::audit(&program("pub fn run() {}"), &approved, &[]).is_ok());
    let changed = program("pub fn run() {} pub struct NewPublicType;");
    let errors = policy::audit(&changed, &approved, &[])
        .unwrap_err()
        .join("\n");
    assert!(errors.contains("named root"), "{errors}");
    let changed = program("#[cfg(feature=\"test-support\")] pub fn run() {}");
    let errors = policy::audit(&changed, &approved, &[])
        .unwrap_err()
        .join("\n");
    assert!(errors.contains("kind/gating"), "{errors}");
}

#[test]
fn supplemental_evidence_cannot_change_or_omit_the_deliberate_root_approvals() {
    for (names, evidence) in [
        ("fixture|run\n", ""),
        ("fixture|run\n", "fixture|other|fn|\n"),
        ("fixture|*\n", "fixture|*|fn|\n"),
        ("fixture|run\nfixture|run\n", "fixture|run|fn|\n"),
    ] {
        assert!(
            Approvals::parse(names, evidence).is_err(),
            "{names:?} / {evidence:?}"
        );
    }
    let actual = policy::regenerate(&program("pub fn run() {}"), &[]).unwrap();
    let parsed = Approvals::parse(&actual.names_text(), &actual.evidence_text()).unwrap();
    assert!(policy::audit(&program("pub fn run() {}"), &parsed, &[]).is_ok());
}

#[test]
fn an_extern_self_alias_is_diagnosed_as_whole_crate_exposure() {
    let program = program("pub extern crate self as PublicCrate; pub fn run() {}");
    let errors = policy::regenerate(&program, &[]).unwrap_err().join("\n");
    assert!(
        errors.contains("whole-crate export") && errors.contains("PublicCrate"),
        "{errors}"
    );
}

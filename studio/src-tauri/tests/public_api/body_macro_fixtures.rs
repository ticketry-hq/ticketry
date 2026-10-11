use super::{model::CrateInput, policy, source};
use std::collections::BTreeMap;
use std::process::Command;

fn externally_exported_macro_is_rejected(text: &str) {
    let directory = tempfile::tempdir().unwrap();
    let path = directory.path();
    let root = path.join("lib.rs");
    std::fs::write(&root, text).unwrap();
    std::fs::write(path.join("caller.rs"), "fn main() { consumer::hidden!(); }").unwrap();
    for arguments in [
        vec![
            "lib.rs",
            "--edition=2021",
            "--crate-type=lib",
            "--crate-name=consumer",
        ],
        vec![
            "caller.rs",
            "--edition=2021",
            "--extern",
            "consumer=libconsumer.rlib",
        ],
    ] {
        let output = Command::new("rustc")
            .current_dir(path)
            .args(arguments)
            .output()
            .unwrap();
        assert!(
            output.status.success(),
            "{}",
            String::from_utf8_lossy(&output.stderr)
        );
    }
    let program = source::load_crates(&[CrateInput {
        name: "consumer".into(),
        root,
        dependencies: BTreeMap::new(),
    }]);
    let errors = policy::regenerate(&program, &[])
        .expect_err("body macro expansion must not hide a compiled root export");
    assert!(
        errors
            .iter()
            .any(|error| error.contains("unsupported") && error.contains("compile evidence")),
        "{errors:?}"
    );
}

#[test]
fn a_custom_body_macro_cannot_conceal_an_exported_root_macro() {
    externally_exported_macro_is_rejected("macro_rules! make { () => { #[macro_export] macro_rules! hidden { () => {} } } } pub fn run() { make!(); }");
}

#[test]
fn a_standard_macro_argument_cannot_conceal_an_explicit_export_attribute() {
    externally_exported_macro_is_rejected(
        "pub fn run() { assert!({ #[macro_export] macro_rules! hidden { () => {} } true }); }",
    );
}

#[test]
fn a_custom_macro_nested_in_standard_arguments_cannot_hide_a_root_export() {
    externally_exported_macro_is_rejected("macro_rules! make { () => { { #[macro_export] macro_rules! hidden { () => {} } true } } } pub fn run() { assert!(make!()); }");
}

#[test]
fn reviewed_nested_standard_macros_preserve_a_flat_leaf_contract() {
    let directory = tempfile::tempdir().unwrap();
    let root = directory.path().join("lib.rs");
    std::fs::write(
        &root,
        "pub fn run() { assert!(matches!(true, true)); println!(\"use mod macro_rules\"); }",
    )
    .unwrap();
    let output = Command::new("rustc")
        .args(["--edition=2021", "--crate-type=lib"])
        .arg(&root)
        .arg("--out-dir")
        .arg(directory.path())
        .output()
        .unwrap();
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
    let program = source::load_crates(&[CrateInput {
        name: "consumer".into(),
        root,
        dependencies: BTreeMap::new(),
    }]);
    let approvals =
        super::inventory::Approvals::parse("consumer|run\n", "consumer|run|fn|\n").unwrap();
    policy::audit(&program, &approvals, &[]).unwrap();
}

#[test]
fn opaque_local_imports_cannot_override_a_standard_macro_in_its_arguments() {
    externally_exported_macro_is_rejected("mod imports { macro_rules! custom { () => { #[macro_export] macro_rules! hidden { () => {} } } } pub(crate) use custom as println; } pub fn run() { assert!({ use crate::imports::println; println!(); true }); }");
}

#[test]
fn method_attributes_cannot_conceal_unreviewed_export_bearing_expansions() {
    let directory = tempfile::tempdir().unwrap();
    let root = directory.path().join("lib.rs");
    std::fs::write(&root, "pub struct Approved; impl Approved { #[unknown::expand] pub fn run() {} } pub trait Service { #[unknown::expand] fn run(); }").unwrap();
    let program = source::load_crates(&[CrateInput {
        name: "fixture".into(),
        root,
        dependencies: BTreeMap::new(),
    }]);
    assert!(!program.diagnostics.is_empty());
}

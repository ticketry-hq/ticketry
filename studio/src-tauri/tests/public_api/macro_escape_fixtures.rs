use super::super::{policy, source};
use super::{compile, CrateInput};
use std::collections::BTreeMap;

#[test]
fn macro_export_inside_a_function_is_an_externally_reachable_root_item() {
    let directory = tempfile::tempdir().unwrap();
    let root = directory.path().join("lib.rs");
    let caller = directory.path().join("caller.rs");
    std::fs::write(
        &root,
        "pub fn run() { #[macro_export] macro_rules! injected { () => {} } }",
    )
    .unwrap();
    std::fs::write(&caller, "fn main() { consumer::injected!(); }").unwrap();
    let output = compile(
        &[
            "--crate-type=lib",
            "--crate-name=consumer",
            root.to_str().unwrap(),
        ],
        directory.path(),
    );
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
    let library = format!("consumer={}/libconsumer.rlib", directory.path().display());
    let output = compile(
        &[caller.to_str().unwrap(), "--extern", &library],
        directory.path(),
    );
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
    match policy::regenerate(&program, &[]) {
        Ok(inventory) => assert!(
            inventory
                .roots
                .iter()
                .any(|item| item.name == "injected" && item.kind == "macro"),
            "{inventory:?}"
        ),
        Err(errors) => assert!(
            errors
                .iter()
                .any(|error| error.contains("unsupported") && error.contains("macro_export")),
            "{errors:?}"
        ),
    }
}

#[test]
fn a_raw_import_alias_cannot_conceal_the_identity_of_a_shadowed_builtin_derive() {
    let directory = tempfile::tempdir().unwrap();
    let macro_source = directory.path().join("derive.rs");
    let root = directory.path().join("lib.rs");
    std::fs::write(&macro_source, r#"
        extern crate proc_macro;
        #[proc_macro_derive(Clone)] pub fn clone(_: proc_macro::TokenStream) -> proc_macro::TokenStream {
            "pub mod hidden {}".parse().unwrap()
        }
    "#).unwrap();
    std::fs::write(
        &root,
        "use macro_spoof::Clone as r#Clone; #[derive(Clone)] pub struct Approved;",
    )
    .unwrap();
    let output = compile(
        &[
            "--crate-type=proc-macro",
            "--crate-name=macro_spoof",
            macro_source.to_str().unwrap(),
        ],
        directory.path(),
    );
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
    let library = format!(
        "macro_spoof={}/{}macro_spoof{}",
        directory.path().display(),
        std::env::consts::DLL_PREFIX,
        std::env::consts::DLL_SUFFIX
    );
    let output = compile(
        &[
            "--crate-type=lib",
            root.to_str().unwrap(),
            "--extern",
            &library,
        ],
        directory.path(),
    );
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
    let program = source::load_crates(&[CrateInput {
        name: "consumer".into(),
        root,
        dependencies: BTreeMap::from([("macro_spoof".into(), "macro-spoof".into())]),
    }]);
    let errors = policy::regenerate(&program, &[])
        .expect_err("raw spelling is the same macro identifier and must fail provenance");
    assert!(
        errors
            .iter()
            .any(|error| error.contains("Clone") && error.contains("unsupported")),
        "{errors:?}"
    );
}

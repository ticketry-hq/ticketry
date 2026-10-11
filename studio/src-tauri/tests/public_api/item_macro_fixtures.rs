use super::{model::CrateInput, policy, source};
use std::collections::BTreeMap;

fn load(text: &str) -> super::model::Program {
    let directory = tempfile::tempdir().unwrap();
    let root = directory.path().join("lib.rs");
    std::fs::write(&root, text).unwrap();
    source::load_crates(&[CrateInput {
        name: "consumer".into(),
        root,
        dependencies: BTreeMap::from([
            ("tokio".into(), "tokio".into()),
            ("seaography".into(), "seaography".into()),
        ]),
    }])
}

#[test]
fn supported_local_key_macros_preserve_public_static_names_and_cfg() {
    let program = load("tokio::task_local! { #[cfg(feature = \"task\")] pub static TASK: u8; static INTERNAL: u8; } thread_local! { pub static THREAD: u8 = 1; static PRIVATE: u8 = const { 2 }; }");
    let inventory = policy::regenerate(&program, &[]).unwrap();
    assert_eq!(inventory.names_text(), "# One `crate|exported_name` approval per public library-root item.\n# Keep entries sorted first by crate, then by exported name.\nconsumer|TASK\nconsumer|THREAD\n");
    assert!(inventory.roots.iter().any(|root| root.name == "TASK"
        && root.kind == "static"
        && root.gates == ["cfg (feature = \"task\")"]));
}

#[test]
fn supported_seaography_registration_macro_has_one_public_function() {
    let program = load("seaography::register_entity_modules!([migration_probes,]);");
    let inventory = policy::regenerate(&program, &[]).unwrap();
    assert_eq!(inventory.roots.len(), 1);
    let root = inventory.roots.iter().next().unwrap();
    assert_eq!(root.name, "register_entity_modules");
    assert_eq!(root.kind, "fn");
}

#[test]
fn item_macros_reject_unreviewed_shapes_and_dependency_shadows() {
    for text in [
        "tokio::task_local! { pub fn hidden() {} }",
        "thread_local! { mod hidden {} }",
        "seaography::register_entity_modules!([implementation::entity]);",
        "mod tokio {} tokio::task_local! { pub static KEY: u8; }",
        "macro_rules! thread_local { ($($t:tt)*) => {} } thread_local! { pub static KEY: u8 = 1; }",
    ] {
        let program = load(text);
        assert!(
            policy::regenerate(&program, &[]).is_err(),
            "must reject unsupported expansion: {text}"
        );
    }
}

#[test]
fn a_local_key_initializer_cannot_conceal_an_exported_macro() {
    let program = load(
        "thread_local! { static KEY: () = { #[macro_export] macro_rules! hidden { () => {} } }; }",
    );
    assert!(policy::regenerate(&program, &[]).is_err());
}

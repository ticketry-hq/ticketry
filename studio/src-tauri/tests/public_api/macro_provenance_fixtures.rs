use std::collections::BTreeMap;
use std::path::Path;
use std::process::{Command, Output};

use super::{model::CrateInput, policy, source};

#[path = "macro_escape_fixtures.rs"]
mod macro_escape_fixtures;
#[path = "union_origin_fixtures.rs"]
mod union_origin_fixtures;

fn compile(arguments: &[&str], directory: &Path) -> Output {
    Command::new("rustc")
        .args(arguments)
        .arg("--edition=2021")
        .arg("--out-dir")
        .arg(directory)
        .output()
        .unwrap()
}

#[test]
fn a_custom_derive_named_clone_cannot_hide_a_compiled_public_namespace() {
    let directory = tempfile::tempdir().unwrap();
    let macro_source = directory.path().join("derive.rs");
    let consumer = directory.path().join("consumer.rs");
    let caller = directory.path().join("caller.rs");
    std::fs::write(
        &macro_source,
        r#"
        extern crate proc_macro;
        use proc_macro::TokenStream;
        #[proc_macro_derive(Clone)]
        pub fn clone(_: TokenStream) -> TokenStream {
            "pub mod hidden { pub fn helper() {} }".parse().unwrap()
        }
    "#,
    )
    .unwrap();
    std::fs::write(
        &consumer,
        "use macro_spoof::Clone; #[derive(Clone)] pub struct Approved;",
    )
    .unwrap();
    std::fs::write(&caller, "fn main() { consumer::hidden::helper(); }").unwrap();
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
            "--crate-name=consumer",
            consumer.to_str().unwrap(),
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
    let consumer_library = format!("consumer={}/libconsumer.rlib", directory.path().display());
    let output = compile(
        &[
            caller.to_str().unwrap(),
            "--extern",
            &consumer_library,
            "-L",
            directory.path().to_str().unwrap(),
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
        root: consumer,
        dependencies: BTreeMap::from([("macro_spoof".into(), "macro-spoof".into())]),
    }]);
    let errors = policy::regenerate(&program, &[]).expect_err(
        "a shadowed built-in derive needs explicit supported provenance and expansion evidence",
    );
    assert!(
        errors
            .iter()
            .any(|error| error.contains("Clone") && error.contains("unsupported")),
        "{errors:?}"
    );
}

#[test]
fn an_ancestor_macro_use_cannot_hide_a_derive_exported_root_macro() {
    let directory = tempfile::tempdir().unwrap();
    let macro_source = directory.path().join("derive.rs");
    let consumer = directory.path().join("consumer.rs");
    let caller = directory.path().join("caller.rs");
    std::fs::write(
        &macro_source,
        r##"
        extern crate proc_macro;
        use proc_macro::TokenStream;
        #[proc_macro_derive(Clone)]
        pub fn clone(_: TokenStream) -> TokenStream {
            "#[macro_export] macro_rules! injected { () => {} }".parse().unwrap()
        }
    "##,
    )
    .unwrap();
    std::fs::write(&consumer, "#[macro_use] extern crate macro_spoof; mod internal { #[derive(Clone)] pub struct Approved; } pub use internal::Approved;").unwrap();
    std::fs::write(&caller, "fn main() { consumer::injected!(); }").unwrap();
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
            "--crate-name=consumer",
            consumer.to_str().unwrap(),
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
    let consumer_library = format!("consumer={}/libconsumer.rlib", directory.path().display());
    let output = compile(
        &[
            caller.to_str().unwrap(),
            "--extern",
            &consumer_library,
            "-L",
            directory.path().to_str().unwrap(),
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
        root: consumer,
        dependencies: BTreeMap::from([("macro_spoof".into(), "macro-spoof".into())]),
    }]);
    let errors = policy::regenerate(&program, &[]).expect_err(
        "ancestor macro_use can shadow derives and introduce externally reachable root macros",
    );
    assert!(
        errors
            .iter()
            .any(|error| error.contains("Clone") && error.contains("unsupported")),
        "{errors:?}"
    );
}

#[test]
fn shadowed_framework_names_unknown_globs_and_helper_attributes_fail_provenance() {
    let dependencies = BTreeMap::from([
        ("sea_orm".into(), "sea-orm".into()),
        ("serde".into(), "serde".into()),
        ("evil".into(), "evil-macros".into()),
    ]);
    for definition in [
        "use evil::*; #[derive(Clone)] pub struct Approved;",
        "use evil::DeriveEntityModel; #[derive(DeriveEntityModel)] pub struct Model { pub id:i32 }",
        "mod serde {} #[derive(serde::Serialize)] pub struct Approved;",
        "mod sea_orm {} #[sea_orm::model] #[derive(sea_orm::DeriveEntityModel)] pub struct Model { pub id:i32 }",
        "use evil::custom as serde; #[serde(rename_all=\"camelCase\")] pub struct Approved;",
        "use evil::custom as sea_orm; #[sea_orm(table_name=\"example\")] pub struct Approved;",
    ] {
        let directory = tempfile::tempdir().unwrap();
        let root = directory.path().join("lib.rs");
        std::fs::write(&root, definition).unwrap();
        let program = source::load_crates(&[CrateInput {
            name: "fixture".into(), root, dependencies: dependencies.clone(),
        }]);
        assert!(program.diagnostics.iter().any(|error| error.contains("unsupported") && error.contains("provenance")), "{definition}: {:?}", program.diagnostics);
        assert!(policy::regenerate(&program, &[]).is_err());
    }
}

#[test]
fn genuine_builtin_and_canonical_serde_derives_preserve_approved_leafs() {
    for definition in [
        "#[derive(Clone, Debug, PartialEq, Eq)] pub struct Approved;",
        "#[derive(serde::Serialize, serde::Deserialize)] #[serde(rename_all=\"camelCase\")] pub struct Approved;",
        "use serde::Serialize; #[derive(Serialize)] pub struct Approved;",
    ] {
        let directory = tempfile::tempdir().unwrap();
        let root = directory.path().join("lib.rs");
        std::fs::write(&root, definition).unwrap();
        let program = source::load_crates(&[CrateInput {
            name: "fixture".into(), root,
            dependencies: BTreeMap::from([("serde".into(), "serde".into())]),
        }]);
        let inventory = policy::regenerate(&program, &[]).unwrap_or_else(|errors| panic!("{definition}: {errors:?}"));
        assert_eq!(inventory.roots.len(), 1);
        assert_eq!(inventory.roots.first().unwrap().kind, "struct");
    }
}

#[test]
fn a_workspace_package_named_after_a_framework_is_not_canonical_macro_proof() {
    for (package, alias, definition) in [
        (
            "serde",
            "serde",
            "#[derive(serde::Serialize)] pub struct Approved;",
        ),
        (
            "sea-orm",
            "sea_orm",
            "#[derive(sea_orm::DeriveEntityModel)] pub struct Model { pub id:i32 }",
        ),
    ] {
        let directory = tempfile::tempdir().unwrap();
        let provider = directory.path().join("provider.rs");
        let root = directory.path().join("lib.rs");
        std::fs::write(&provider, "pub struct UnknownMacroProvider;").unwrap();
        std::fs::write(&root, definition).unwrap();
        let program = source::load_crates(&[
            CrateInput {
                name: package.into(),
                root: provider,
                dependencies: BTreeMap::new(),
            },
            CrateInput {
                name: "fixture".into(),
                root,
                dependencies: BTreeMap::from([(alias.into(), package.into())]),
            },
        ]);
        assert!(
            program
                .diagnostics
                .iter()
                .any(|error| error.contains("unsupported macro provenance")),
            "{package}: {:?}",
            program.diagnostics
        );
        assert!(policy::regenerate(&program, &[]).is_err());
    }
}

#[test]
fn unsupported_dependency_sources_cannot_prove_canonical_framework_macro_identity() {
    for package in ["serde", "sea-orm"] {
        for dependency_source in [
            None,
            Some("git+https://example.invalid/framework"),
            Some("registry+https://example.invalid/index"),
        ] {
            let metadata = serde_json::json!({
                "workspace_members":["fixture"],
                "packages":[{"id":"fixture", "name":"fixture",
                    "targets":[{"kind":["lib"], "name":"fixture", "src_path":"/fixture/lib.rs"}],
                    "dependencies":[{"name":package, "rename":null, "source":dependency_source}]}]
            });
            let error = super::workspace::from_metadata(&metadata.to_string()).expect_err(
                "a canonical package spelling cannot approve custom/path/git registry macros",
            );
            assert!(
                error.contains(package) && error.contains("unsupported"),
                "{error}"
            );
        }
    }
}

#[test]
fn resolved_metadata_tolerates_unrelated_dependency_versions() {
    let metadata = serde_json::json!({
        "workspace_members":["fixture"],
        "packages":[
            {"id":"fixture", "name":"fixture", "dependencies":[],
                "targets":[{"kind":["lib"], "name":"fixture", "src_path":"/fixture/lib.rs"}]},
            {"id":"unrelated-v1", "name":"unrelated", "dependencies":[],
                "targets":[{"kind":["lib"], "name":"unrelated", "src_path":"/thirdparty/v1/lib.rs"}]},
            {"id":"unrelated-v2", "name":"unrelated", "dependencies":[],
                "targets":[{"kind":["lib"], "name":"unrelated", "src_path":"/thirdparty/v2/lib.rs"}]}
        ]
    });
    let roots = super::workspace::from_metadata(&metadata.to_string()).unwrap();
    assert_eq!(roots.len(), 1);
    assert_eq!(roots[0].name, "fixture");
}

#[test]
fn private_workspace_globs_preserve_standard_macro_provenance() {
    let directory = tempfile::tempdir().unwrap();
    let root = directory.path().join("lib.rs");
    std::fs::write(&root, "mod implementation { pub fn run() {} #[cfg(test)] mod tests { use super::*; #[test] fn smoke() { assert!(true); } } } pub use implementation::run;").unwrap();
    let program = source::load_crates(&[CrateInput {
        name: "fixture".into(),
        root,
        dependencies: BTreeMap::new(),
    }]);
    assert!(program.diagnostics.is_empty(), "{:?}", program.diagnostics);
    policy::regenerate(&program, &[]).unwrap();
}

#[test]
fn reviewed_trait_and_runtime_expansions_require_canonical_dependencies() {
    let directory = tempfile::tempdir().unwrap();
    let root = directory.path().join("lib.rs");
    std::fs::write(&root, "use seaography::{CustomFields, CustomOutputType}; use async_trait::async_trait; #[derive(CustomOutputType)] pub struct Output; #[async_trait] pub trait Service { async fn run(&self); } #[CustomFields] impl Output {} #[cfg(test)] mod tests { #[tokio::test] async fn smoke() { let value = serde_json::json!({\"ok\": true}); assert!(value.is_object()); } }").unwrap();
    let dependencies = BTreeMap::from([
        ("seaography".into(), "seaography".into()),
        ("async_trait".into(), "async-trait".into()),
        ("tokio".into(), "tokio".into()),
        ("serde_json".into(), "serde_json".into()),
    ]);
    let program = source::load_crates(&[CrateInput {
        name: "fixture".into(),
        root: root.clone(),
        dependencies,
    }]);
    assert!(program.diagnostics.is_empty(), "{:?}", program.diagnostics);
    policy::regenerate(&program, &[]).unwrap();
    let spoof = source::load_crates(&[CrateInput {
        name: "fixture".into(),
        root,
        dependencies: BTreeMap::from([("seaography".into(), "local-spoof".into())]),
    }]);
    assert!(!spoof.diagnostics.is_empty());
}

#[test]
fn tauri_command_generated_root_macros_retain_exact_cfg_conditions() {
    let directory = tempfile::tempdir().unwrap();
    let root = directory.path().join("lib.rs");
    std::fs::write(&root, "mod implementation { #[cfg(feature = \"native\")] #[cfg_attr(feature = \"desktop\", tauri::command)] pub(crate) fn attach() {} }").unwrap();
    let program = source::load_crates(&[CrateInput {
        name: "fixture".into(),
        root,
        dependencies: BTreeMap::from([("tauri".into(), "tauri".into())]),
    }]);
    let inventory = policy::regenerate(&program, &[]).unwrap();
    assert_eq!(inventory.roots.len(), 2);
    let names = inventory
        .roots
        .iter()
        .map(|item| item.name.as_str())
        .collect::<std::collections::BTreeSet<_>>();
    assert_eq!(
        names,
        std::collections::BTreeSet::from(["__cmd__attach", "__tauri_command_name_attach"])
    );
    for item in inventory.roots {
        assert_eq!(item.kind, "macro");
        assert_eq!(
            item.gates,
            ["cfg (feature = \"native\")", "cfg(feature = \"desktop\")"]
        );
    }
}

#[test]
fn reviewed_nested_serde_derives_are_checked_against_local_import_shadows() {
    let directory = tempfile::tempdir().unwrap();
    let root = directory.path().join("lib.rs");
    std::fs::write(
        &root,
        "use serde::Serialize; pub fn run() { #[derive(Serialize)] struct Local; }",
    )
    .unwrap();
    let input = || CrateInput {
        name: "fixture".into(),
        root: root.clone(),
        dependencies: BTreeMap::from([("serde".into(), "serde".into())]),
    };
    let program = source::load_crates(&[input()]);
    assert!(program.diagnostics.is_empty(), "{:?}", program.diagnostics);
    std::fs::write(&root, "use serde::Serialize; pub fn run() { use spoof::Serialize; #[derive(Serialize)] struct Local; }").unwrap();
    assert!(!source::load_crates(&[input()]).diagnostics.is_empty());
}

#[test]
fn a_body_dependency_alias_cannot_replace_a_reviewed_runtime_macro() {
    let directory = tempfile::tempdir().unwrap();
    let root = directory.path().join("lib.rs");
    std::fs::write(
        &root,
        "pub fn run() { use spoof as serde_json; serde_json::json!({}); }",
    )
    .unwrap();
    let program = source::load_crates(&[CrateInput {
        name: "fixture".into(),
        root,
        dependencies: BTreeMap::from([("serde_json".into(), "serde_json".into())]),
    }]);
    assert!(!program.diagnostics.is_empty());
}

#[test]
fn an_unknown_glob_cannot_compete_with_a_reviewed_derive_glob() {
    let directory = tempfile::tempdir().unwrap();
    let root = directory.path().join("lib.rs");
    std::fs::write(
        &root,
        "use serde::*; use spoof::*; #[derive(Serialize)] pub struct Approved;",
    )
    .unwrap();
    let program = source::load_crates(&[CrateInput {
        name: "fixture".into(),
        root,
        dependencies: BTreeMap::from([
            ("serde".into(), "serde".into()),
            ("spoof".into(), "spoof".into()),
        ]),
    }]);
    assert!(!program.diagnostics.is_empty());
}

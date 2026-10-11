use std::collections::BTreeMap;

use super::model::CrateInput;
use super::{policy, resolve, source, workspace};

#[path = "source_edge_fixtures.rs"]
mod edges;

#[test]
fn conditional_inline_module_locations_audit_both_export_sources() {
    let directory = tempfile::tempdir().unwrap();
    std::fs::create_dir(directory.path().join("implementation")).unwrap();
    std::fs::create_dir(directory.path().join("alternate")).unwrap();
    std::fs::write(
        directory.path().join("lib.rs"),
        r#"
        #[cfg_attr(feature = "alternate", path = "alternate")]
        mod implementation { mod capability; pub use capability::run; }
        pub use implementation::run;
    "#,
    )
    .unwrap();
    std::fs::write(
        directory.path().join("implementation/capability.rs"),
        "pub fn run() {}",
    )
    .unwrap();
    std::fs::write(
        directory.path().join("alternate/capability.rs"),
        "pub fn run() {}",
    )
    .unwrap();
    let program = source::load_crates(&[CrateInput {
        name: "fixture".into(),
        root: directory.path().join("lib.rs"),
        dependencies: BTreeMap::new(),
    }]);
    assert!(program.diagnostics.is_empty(), "{:?}", program.diagnostics);
    let exported = resolve::Resolver::new(&program)
        .resolve(program.crates["fixture"].root, "run")
        .unwrap();
    assert_eq!(
        exported.len(),
        2,
        "both cfg_attr path alternatives must reach the public contract"
    );
    assert!(exported
        .iter()
        .any(|export| export.gates.iter().any(|gate| gate.contains("alternate"))));
    assert!(
        exported
            .iter()
            .any(|export| export.gates.iter().any(|gate| gate.contains("not("))),
        "default source evidence must retain the complement of the cfg_attr path condition"
    );
}

#[test]
fn cargo_metadata_dependency_aliases_reach_workspace_leaf_exports() {
    let directory = tempfile::tempdir().unwrap();
    let root = directory.path().join("consumer.rs");
    let dependency = directory.path().join("provider.rs");
    std::fs::write(&root, "pub use renamed_dep::run as execute;").unwrap();
    std::fs::write(&dependency, "pub fn run() {}").unwrap();
    let metadata = serde_json::json!({
        "workspace_members": ["consumer-id", "provider-id"],
        "packages": [
            {"id":"consumer-id", "name":"consumer", "targets":[{"kind":["lib"],"src_path":root}],
             "dependencies":[{"name":"provider-package", "rename":"renamed_dep"}]},
            {"id":"provider-id", "name":"provider-package", "targets":[{"kind":["lib"],"src_path":dependency}],
             "dependencies":[]}
        ]
    });
    let inputs = workspace::from_metadata(&metadata.to_string()).unwrap();
    let program = source::load_crates(&inputs);
    assert!(
        program.crates.contains_key("consumer"),
        "metadata must include workspace library roots"
    );
    let inventory = policy::regenerate(&program, &[]).unwrap();
    assert!(inventory
        .roots
        .iter()
        .any(|root| root.crate_name == "consumer" && root.name == "execute" && root.kind == "fn"));
}

#[test]
fn unresolved_attribute_and_derive_expansion_cannot_be_approved_as_a_leaf() {
    for definition in [
        "#[derive(CustomExport)] pub struct Approved;",
        "#[custom_export] pub struct Approved;",
    ] {
        let directory = tempfile::tempdir().unwrap();
        std::fs::write(directory.path().join("lib.rs"), definition).unwrap();
        let program = source::load_crates(&[CrateInput {
            name: "fixture".into(),
            root: directory.path().join("lib.rs"),
            dependencies: BTreeMap::new(),
        }]);
        let errors = policy::regenerate(&program, &[])
            .expect_err("unknown expansion must fail closed before approvals refresh");
        assert!(
            errors
                .iter()
                .any(|error| error.contains("unsupported") && error.contains("compile evidence")),
            "{errors:?}"
        );
    }
}

#[test]
fn path_attributed_file_modules_resolve_nested_files_like_rustc() {
    let directory = tempfile::tempdir().unwrap();
    std::fs::write(
        directory.path().join("lib.rs"),
        "#[path = \"custom.rs\"] mod logical; pub use logical::run;",
    )
    .unwrap();
    std::fs::write(
        directory.path().join("custom.rs"),
        "mod child; pub use child::run;",
    )
    .unwrap();
    std::fs::write(directory.path().join("child.rs"), "pub fn run() {}").unwrap();
    let compiled = std::process::Command::new("rustc")
        .args(["--edition=2021", "--crate-type=lib"])
        .arg(directory.path().join("lib.rs"))
        .arg("--out-dir")
        .arg(directory.path())
        .output()
        .unwrap();
    assert!(
        compiled.status.success(),
        "{}",
        String::from_utf8_lossy(&compiled.stderr)
    );
    let program = source::load_crates(&[CrateInput {
        name: "fixture".into(),
        root: directory.path().join("lib.rs"),
        dependencies: BTreeMap::new(),
    }]);
    let inventory = policy::regenerate(&program, &[]).unwrap();
    assert!(inventory
        .roots
        .iter()
        .any(|root| root.name == "run" && root.kind == "fn"));
}

#[test]
fn foreign_public_leaf_declarations_are_included_in_root_approvals() {
    let directory = tempfile::tempdir().unwrap();
    std::fs::write(
        directory.path().join("lib.rs"),
        "extern \"C\" { pub fn run(); pub static LIMIT: usize; }",
    )
    .unwrap();
    let program = source::load_crates(&[CrateInput {
        name: "fixture".into(),
        root: directory.path().join("lib.rs"),
        dependencies: BTreeMap::new(),
    }]);
    let inventory = policy::regenerate(&program, &[]).unwrap();
    assert!(inventory
        .roots
        .iter()
        .any(|root| root.name == "run" && root.kind == "fn"));
    assert!(inventory
        .roots
        .iter()
        .any(|root| root.name == "LIMIT" && root.kind == "static"));
}

#[test]
fn metadata_alias_conflicts_cannot_select_one_conditional_dependency() {
    let metadata = serde_json::json!({
        "workspace_members": ["consumer-id"],
        "packages": [{"id":"consumer-id", "name":"consumer",
            "targets":[{"kind":["lib"],"src_path":"/fixture/lib.rs"}],
            "dependencies":[{"name":"first", "rename":"alias"}, {"name":"second", "rename":"alias"}]}]
    });
    let error = workspace::from_metadata(&metadata.to_string())
        .expect_err("conditional alias conflicts must fail conservatively");
    assert!(
        error.contains("alias") && error.contains("first") && error.contains("second"),
        "{error}"
    );
}

#[test]
fn metadata_library_kinds_are_not_silently_omitted() {
    for kind in ["lib", "rlib", "dylib", "cdylib", "staticlib", "proc-macro"] {
        let metadata = serde_json::json!({
            "workspace_members": ["library-id"],
            "packages": [{"id":"library-id", "name":"library", "dependencies":[],
                "targets":[{"kind":[kind], "src_path":"/fixture/lib.rs"}]}]
        });
        let roots = workspace::from_metadata(&metadata.to_string()).unwrap();
        assert_eq!(roots.len(), 1, "library target kind {kind} must be audited");
    }
}

#[test]
fn source_file_unions_preserve_each_target_kind_and_path_gate() {
    let directory = tempfile::tempdir().unwrap();
    std::fs::write(
        directory.path().join("lib.rs"),
        r#"
        #[cfg_attr(feature = "alternate", path = "alternate.rs")]
        mod implementation;
        pub use implementation::run;
    "#,
    )
    .unwrap();
    std::fs::write(
        directory.path().join("implementation.rs"),
        "pub fn run() {}",
    )
    .unwrap();
    std::fs::write(
        directory.path().join("alternate.rs"),
        "#[allow(non_upper_case_globals)] pub const run: usize = 1;",
    )
    .unwrap();
    let program = source::load_crates(&[CrateInput {
        name: "fixture".into(),
        root: directory.path().join("lib.rs"),
        dependencies: BTreeMap::new(),
    }]);
    let inventory = policy::regenerate(&program, &[]).unwrap();
    assert!(inventory.roots.iter().any(|root| root.name == "run"
        && root.kind == "fn"
        && root.gates.iter().any(|gate| gate.contains("not("))));
    assert!(inventory.roots.iter().any(|root| root.name == "run"
        && root.kind == "const"
        && root.gates.iter().any(|gate| gate.contains("alternate"))));
}

#[test]
fn exported_macros_in_private_ancestors_are_root_contract_items() {
    let directory = tempfile::tempdir().unwrap();
    std::fs::write(
        directory.path().join("lib.rs"),
        r#"
        mod implementation {
            #[cfg(feature = "macros")]
            #[macro_export]
            macro_rules! approved { () => {} }
            pub fn run() { println!("a body macro cannot alter the crate facade"); }
        }
        pub use implementation::run;
    "#,
    )
    .unwrap();
    let program = source::load_crates(&[CrateInput {
        name: "fixture".into(),
        root: directory.path().join("lib.rs"),
        dependencies: BTreeMap::new(),
    }]);
    let inventory = policy::regenerate(&program, &[]).unwrap();
    assert!(inventory.roots.iter().any(|root| root.name == "approved"
        && root.kind == "macro"
        && root.gates.iter().any(|gate| gate.contains("macros"))));
    assert!(inventory.roots.iter().any(|root| root.name == "run"));
}

#[test]
fn unsupported_expansions_and_inactive_targets_fail_before_inventory_refresh() {
    for (definition, cause) in [
        ("export_capabilities!();", "unsupported item macro"),
        ("#[cfg(any())] pub use unknown::run;", "unresolved"),
        (
            "#[cfg_attr(feature = \"custom\", path = concat!(\"file.rs\"))] mod implementation;",
            "path",
        ),
        ("#[path=\"lib.rs\"] mod recursive;", "source module cycle"),
    ] {
        let directory = tempfile::tempdir().unwrap();
        std::fs::write(directory.path().join("lib.rs"), definition).unwrap();
        let program = source::load_crates(&[CrateInput {
            name: "fixture".into(),
            root: directory.path().join("lib.rs"),
            dependencies: BTreeMap::new(),
        }]);
        let errors =
            policy::regenerate(&program, &[]).expect_err("unresolved source cannot be approved");
        assert!(
            errors.iter().any(|error| error.contains(cause)),
            "{definition}: {errors:?}"
        );
    }
}

#[test]
fn unresolved_conditional_source_diagnostics_include_gating_evidence() {
    let directory = tempfile::tempdir().unwrap();
    std::fs::write(
        directory.path().join("lib.rs"),
        "#[cfg(feature = \"alternate\")] export_capabilities!();",
    )
    .unwrap();
    let program = source::load_crates(&[CrateInput {
        name: "fixture".into(),
        root: directory.path().join("lib.rs"),
        dependencies: BTreeMap::new(),
    }]);
    let errors = policy::regenerate(&program, &[]).unwrap_err();
    assert!(
        errors
            .iter()
            .any(|error| error.contains("alternate") && error.contains("unsupported item macro")),
        "{errors:?}"
    );
}

#[test]
fn a_path_attribute_inside_a_conventional_file_is_relative_to_the_source_file() {
    let directory = tempfile::tempdir().unwrap();
    std::fs::write(
        directory.path().join("lib.rs"),
        "mod conventional; pub use conventional::run;",
    )
    .unwrap();
    std::fs::write(
        directory.path().join("conventional.rs"),
        "#[path = \"sibling.rs\"] mod implementation; pub use implementation::run;",
    )
    .unwrap();
    std::fs::write(directory.path().join("sibling.rs"), "pub fn run() {}").unwrap();
    let program = source::load_crates(&[CrateInput {
        name: "fixture".into(),
        root: directory.path().join("lib.rs"),
        dependencies: BTreeMap::new(),
    }]);
    assert!(program.diagnostics.is_empty(), "{:?}", program.diagnostics);
    let output = std::process::Command::new("rustc")
        .args(["--edition=2021", "--crate-type=lib"])
        .arg(directory.path().join("lib.rs"))
        .arg("--out-dir")
        .arg(directory.path())
        .output()
        .unwrap();
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
}

#[test]
fn literal_item_includes_load_real_exports_and_cannot_hide_root_macros() {
    let directory = tempfile::tempdir().unwrap();
    let root = directory.path().join("lib.rs");
    std::fs::write(
        &root,
        "mod implementation { include!(\"included.rs\"); } pub use implementation::run;",
    )
    .unwrap();
    std::fs::write(
        directory.path().join("included.rs"),
        "pub fn run() {} #[macro_export] macro_rules! root_macro { () => {} }",
    )
    .unwrap();
    let program = source::load_crates(&[CrateInput {
        name: "fixture".into(),
        root: root.clone(),
        dependencies: BTreeMap::new(),
    }]);
    assert!(program.diagnostics.is_empty(), "{:?}", program.diagnostics);
    let inventory = policy::regenerate(&program, &[]).unwrap();
    assert_eq!(inventory.roots.len(), 2);
    assert!(inventory
        .roots
        .iter()
        .any(|item| item.name == "root_macro" && item.kind == "macro"));
    let output = std::process::Command::new("rustc")
        .args(["--edition=2021", "--crate-type=lib"])
        .arg(root)
        .arg("--out-dir")
        .arg(directory.path())
        .output()
        .unwrap();
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
}

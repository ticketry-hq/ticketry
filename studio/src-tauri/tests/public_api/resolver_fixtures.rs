use std::collections::BTreeMap;

use super::model::{CrateInput, Program};
use super::resolve::{Resolved, Resolver, Target};
use super::source::load_crates;

fn fixture(source: &str) -> Program {
    let directory = tempfile::tempdir().unwrap();
    std::fs::write(directory.path().join("lib.rs"), source).unwrap();
    let program = load_crates(&[CrateInput {
        name: "fixture".into(),
        root: directory.path().join("lib.rs"),
        dependencies: BTreeMap::new(),
    }]);
    assert!(program.diagnostics.is_empty(), "{:?}", program.diagnostics);
    program
}

fn resolve(program: &Program, name: &str) -> Result<Vec<Resolved>, Vec<String>> {
    Resolver::new(program).resolve(program.crates["fixture"].root, name)
}

#[test]
fn relative_paths_and_reexports_preserve_leaf_identity_and_gates() {
    let program = fixture(
        r#"
        #[cfg(feature = "test-support")]
        mod internals {
            pub struct Input;
            mod nested {
                pub use super::Input as Local;
                pub use self::Local as Request;
            }
            pub use nested::Request;
        }
        pub use crate::internals::Request as PublicInput;
    "#,
    );
    let values = resolve(&program, "PublicInput").unwrap();
    assert_eq!(values.len(), 1);
    assert!(matches!(&values[0].target, Target::Leaf { name, kind, .. }
        if name == "Input" && kind == "struct"));
    assert!(values[0]
        .gates
        .iter()
        .any(|gate| gate.contains("test-support")));
    assert!(values[0].chain.len() >= 5);
}

#[test]
fn a_private_import_of_a_leaf_cannot_be_reexported() {
    let program = fixture("mod internal { pub struct Input; } use internal::Input as Local; pub use Local as Request;");
    let errors = resolve(&program, "Request").unwrap_err().join("\n");
    assert!(errors.contains("private leaf import"), "{errors}");
    assert!(
        errors.contains("fixture::Request") && errors.contains("fixture::Local"),
        "{errors}"
    );
}

#[test]
fn workspace_dependency_aliases_follow_absolute_reexport_chains() {
    let directory = tempfile::tempdir().unwrap();
    let fixtures = [
        (
            "foundation",
            "mod internal { pub fn run() {} } pub use internal::run as execute;",
            BTreeMap::new(),
        ),
        (
            "bridge",
            "pub use renamed::execute as launch;",
            BTreeMap::from([("renamed".into(), "foundation".into())]),
        ),
        (
            "fixture",
            "pub use ::middle::launch as start; pub use middle as namespace;",
            BTreeMap::from([("middle".into(), "bridge".into())]),
        ),
    ];
    let inputs: Vec<_> = fixtures
        .into_iter()
        .map(|(name, source, dependencies)| {
            let root = directory.path().join(format!("{name}.rs"));
            std::fs::write(&root, source).unwrap();
            CrateInput {
                name: name.into(),
                root,
                dependencies,
            }
        })
        .collect();
    let program = load_crates(&inputs);
    assert!(program.diagnostics.is_empty(), "{:?}", program.diagnostics);
    let values = resolve(&program, "start").unwrap();
    assert!(matches!(&values[0].target, Target::Leaf { name, kind, .. }
        if name == "run" && kind == "fn"));
    let values = resolve(&program, "namespace").unwrap();
    assert_eq!(values[0].target, Target::Crate("bridge".into()));
}

#[test]
fn a_private_leaf_cannot_become_a_public_capability() {
    let program = fixture("mod internal { fn hidden() {} } pub use internal::hidden as expose;");
    let errors = resolve(&program, "expose").unwrap_err().join("\n");
    assert!(errors.contains("private leaf"), "{errors}");
    assert!(
        errors.contains("fixture::expose") && errors.contains("internal::hidden"),
        "{errors}"
    );
}

#[test]
fn dependency_paths_cannot_reach_private_aliases_or_modules() {
    for dependency_source in [
        "mod internal { pub struct Input; } use internal::Input as Hidden;",
        "mod internal { pub struct Input; }",
    ] {
        let directory = tempfile::tempdir().unwrap();
        let dependency = directory.path().join("dependency.rs");
        let root = directory.path().join("lib.rs");
        std::fs::write(&dependency, dependency_source).unwrap();
        std::fs::write(
            &root,
            "pub use dep::Hidden as Secret; pub use dep::internal::Input as Leak;",
        )
        .unwrap();
        let program = load_crates(&[
            CrateInput {
                name: "dependency".into(),
                root: dependency,
                dependencies: BTreeMap::new(),
            },
            CrateInput {
                name: "fixture".into(),
                root,
                dependencies: BTreeMap::from([("dep".into(), "dependency".into())]),
            },
        ]);
        let errors = resolve(&program, "Leak").unwrap_err().join("\n");
        assert!(
            errors.contains("not public across crate boundary"),
            "{errors}"
        );
        if dependency_source.contains("Hidden") {
            let errors = resolve(&program, "Secret").unwrap_err().join("\n");
            assert!(
                errors.contains("not public across crate boundary"),
                "{errors}"
            );
        }
    }
}

#[test]
fn public_globs_fail_with_the_export_and_resolution_chain() {
    let program = fixture("mod internal { pub struct Input; } pub use internal::*;");
    let errors = resolve(&program, "*").unwrap_err().join("\n");
    assert!(errors.contains("public glob"), "{errors}");
    assert!(
        errors.contains("fixture::*") && errors.contains("resolution chain"),
        "{errors}"
    );
}

#[test]
fn cycles_unknown_targets_and_unsupported_paths_never_become_leaf_approvals() {
    for (source, cause) in [
        ("pub use B as A; pub use A as B;", "resolution cycle"),
        ("pub use missing::Input as A;", "unresolved public target"),
        (
            "pub struct Input; pub use Input::Associated as A;",
            "unsupported associated",
        ),
        ("pub use super::Input as A;", "super path escapes"),
        (
            "mod internal { pub struct Input; } pub use ::internal::Input as A;",
            "unsupported absolute dependency",
        ),
    ] {
        let program = fixture(source);
        let errors = resolve(&program, "A").unwrap_err().join("\n");
        assert!(errors.contains(cause), "{source}: {errors}");
        assert!(
            errors.contains("fixture::A") && errors.contains("resolution chain"),
            "{errors}"
        );
    }
}

#[test]
fn non_workspace_dependency_requires_explicit_handling_and_compile_evidence() {
    let directory = tempfile::tempdir().unwrap();
    let root = directory.path().join("lib.rs");
    std::fs::write(&root, "pub use third_party::Input as Request;").unwrap();
    let program = load_crates(&[CrateInput {
        name: "fixture".into(),
        root,
        dependencies: BTreeMap::from([("third_party".into(), "external-package".into())]),
    }]);
    let errors = resolve(&program, "Request").unwrap_err().join("\n");
    assert!(
        errors.contains("non-workspace dependency external-package"),
        "{errors}"
    );
    assert!(errors.contains("compile evidence required"), "{errors}");
}

#[test]
fn named_renamed_and_grouped_self_namespace_exports_retain_module_identity() {
    let program = fixture(
        r#"
        mod internal { pub mod namespace { pub struct Input; } }
        pub use internal::namespace;
        pub use internal::namespace as Alias;
        pub use internal::namespace::{self as Grouped, Input as Request};
    "#,
    );
    for name in ["namespace", "Alias", "Grouped"] {
        assert!(matches!(
            resolve(&program, name).unwrap()[0].target,
            Target::Module(_)
        ));
    }
    assert!(matches!(
        resolve(&program, "Request").unwrap()[0].target,
        Target::Leaf { .. }
    ));
}

#[test]
fn conditional_union_keeps_distinct_leaf_and_module_exposures_and_evidence() {
    let program = fixture(
        r#"
        mod internals { pub struct Input; pub mod namespace {} }
        #[cfg(feature = "leaf")]
        pub use internals::Input as Interface;
        #[cfg(not(feature = "leaf"))]
        pub use internals::namespace as Interface;
    "#,
    );
    let values = resolve(&program, "Interface").unwrap();
    assert_eq!(values.len(), 2);
    assert!(values
        .iter()
        .any(|value| matches!(value.target, Target::Leaf { .. })));
    assert!(values
        .iter()
        .any(|value| matches!(value.target, Target::Module(_))));
    assert!(values
        .iter()
        .all(|value| value.gates.iter().any(|gate| gate.contains("leaf"))));
}

#[test]
fn compiler_confirms_private_namespace_aliases_and_crate_internal_ancestors() {
    for source in [
        "mod internal { pub struct Input; } use internal as local; pub use local::Input as Request;",
        "pub(crate) mod internal { pub struct Input; } pub use crate::internal::Input as Request;",
        "mod internal { pub struct Input; mod nested { pub use super::Input as Local; pub use self::Local as Request; } pub use nested::Request; } pub use internal::Request;",
    ] {
        let program = fixture(source);
        assert!(matches!(resolve(&program, "Request").unwrap()[0].target, Target::Leaf { .. }));
        let directory = tempfile::tempdir().unwrap();
        let root = directory.path().join("lib.rs");
        std::fs::write(&root, source).unwrap();
        let output = std::process::Command::new("rustc")
            .args(["--edition=2021", "--crate-type=lib", "--crate-name=fixture"])
            .arg(&root).arg("--out-dir").arg(directory.path())
            .output().unwrap();
        assert!(output.status.success(), "{source}: {}", String::from_utf8_lossy(&output.stderr));
    }
}

#[test]
fn extern_crate_renames_preserve_the_dependency_identity() {
    let directory = tempfile::tempdir().unwrap();
    let root = directory.path().join("lib.rs");
    let dependency = directory.path().join("dependency.rs");
    std::fs::write(&dependency, "pub struct Input;").unwrap();
    std::fs::write(&root, "extern crate dep as local; pub use local::Input as Request; pub extern crate dep as Everything;").unwrap();
    let program = load_crates(&[
        CrateInput {
            name: "foundation".into(),
            root: dependency,
            dependencies: BTreeMap::new(),
        },
        CrateInput {
            name: "fixture".into(),
            root,
            dependencies: BTreeMap::from([("dep".into(), "foundation".into())]),
        },
    ]);
    assert!(matches!(
        resolve(&program, "Request").unwrap()[0].target,
        Target::Leaf { .. }
    ));
    assert_eq!(
        resolve(&program, "Everything").unwrap()[0].target,
        Target::Crate("foundation".into())
    );
}

#[test]
fn unresolved_conditional_alternative_is_reported_with_its_gate() {
    let program = fixture(
        r#"
        mod internal { pub struct Input; }
        #[cfg(feature = "available")] pub use internal::Input as Request;
        #[cfg(feature = "broken")] pub use missing::Input as Request;
    "#,
    );
    let errors = resolve(&program, "Request").unwrap_err().join("\n");
    assert!(
        errors.contains("unresolved public target") && errors.contains("broken"),
        "{errors}"
    );
}

#[test]
fn a_value_export_can_share_a_name_with_its_private_implementation_module() {
    let directory = tempfile::tempdir().unwrap();
    std::fs::write(directory.path().join("lib.rs"),
        "mod implementation { mod update { pub fn update() {} } pub use update::update; } pub use implementation::update;").unwrap();
    let program = load_crates(&[CrateInput {
        name: "fixture".into(),
        root: directory.path().join("lib.rs"),
        dependencies: BTreeMap::new(),
    }]);
    let resolved = Resolver::new(&program)
        .resolve(program.crates["fixture"].root, "update")
        .unwrap();
    assert_eq!(resolved.len(), 1);
    assert!(matches!(&resolved[0].target, Target::Leaf {kind, ..} if kind == "fn"));
}

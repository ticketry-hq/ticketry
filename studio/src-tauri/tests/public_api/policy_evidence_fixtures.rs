use super::{
    generated_exception, generated_source, policy, source, CompileEvidence, CrateInput,
    DescendantApproval,
};
use std::collections::BTreeMap;

#[test]
fn structurally_invalid_inventory_regeneration_does_not_write_approval_files() {
    let directory = tempfile::tempdir().unwrap();
    std::fs::write(
        directory.path().join("lib.rs"),
        "mod internal { pub fn run() {} } pub use internal as Approved;",
    )
    .unwrap();
    let program = source::load_crates(&[CrateInput {
        name: "fixture".into(),
        root: directory.path().join("lib.rs"),
        dependencies: BTreeMap::new(),
    }]);
    let names = directory.path().join("names.txt");
    let evidence = directory.path().join("evidence.txt");
    std::fs::write(&names, "fixture|Approved\n").unwrap();
    std::fs::write(&evidence, "fixture|Approved|module|\n").unwrap();
    assert!(policy::write_approval_files(&program, &[], &names, &evidence).is_err());
    assert_eq!(
        std::fs::read_to_string(&names).unwrap(),
        "fixture|Approved\n"
    );
    assert_eq!(
        std::fs::read_to_string(&evidence).unwrap(),
        "fixture|Approved|module|\n"
    );
}

#[test]
fn checked_in_generated_records_cover_exact_reviewed_names_and_macro_outputs() {
    let manifest = std::path::Path::new(file!())
        .parent()
        .unwrap()
        .join("../..");
    let exceptions = super::super::exception_records::parse(
        include_str!("../fixtures/public-api-generated-exceptions.json"),
        &manifest,
    )
    .unwrap();
    let program = source::load_crates(&[CrateInput {
        name: "ticketry-entities".into(),
        root: manifest.join("crates/foundation/ticketry-entities/src/lib.rs"),
        dependencies: [
            ("chrono", "chrono"),
            ("sea_orm", "sea-orm"),
            ("seaography", "seaography"),
            ("serde", "serde"),
            ("serde_json", "serde_json"),
            ("tokio", "tokio"),
            ("uuid", "uuid"),
        ]
        .into_iter()
        .map(|(alias, package)| (alias.into(), package.into()))
        .collect(),
    }]);
    let reviewed_names = exceptions
        .iter()
        .map(|record| record.namespace.clone())
        .collect();
    let names = resolved_namespace_names(&program, "ticketry-entities", &reviewed_names);
    assert_eq!(names.len(), 40);
    assert_eq!(
        exceptions
            .iter()
            .map(|record| record.namespace.clone())
            .collect::<std::collections::BTreeSet<_>>(),
        names
    );
    for exception in exceptions {
        assert_eq!(exception.smallest_namespace, exception.namespace);
        let expected = generated_exception()
            .descendants
            .into_iter()
            .map(|item| DescendantApproval {
                path: item
                    .path
                    .replacen("entity::", &format!("{}::", exception.namespace), 1),
                ..item
            })
            .collect();
        assert_eq!(exception.descendants, expected);
    }
}

fn resolved_namespace_names(
    program: &super::super::model::Program,
    crate_name: &str,
    reviewed_names: &std::collections::BTreeSet<String>,
) -> std::collections::BTreeSet<String> {
    use super::super::resolve::{Resolver, Target};
    let root = program.crates[crate_name].root;
    let resolver = Resolver::new(program);
    // Classification is deliberately separate from approving the pre-contraction
    // workspace: structural and macro diagnostics still fail the policy guard.
    program.modules[root]
        .symbols
        .iter()
        .filter_map(|(name, bindings)| {
            if !bindings.iter().any(|binding| binding.public) {
                return None;
            }
            let targets = match resolver.resolve(root, name) {
                Ok(targets) => targets,
                Err(errors) if reviewed_names.contains(name) => {
                    panic!("cannot classify selected namespace {crate_name}::{name}: {errors:?}")
                }
                // Macro-defined registration leaves are unresolved on the
                // baseline. This classification fixture grants no approval;
                // the enforcing policy still rejects their diagnostics.
                Err(_) => return None,
            };
            targets
                .iter()
                .any(|resolved| matches!(resolved.target, Target::Module(_)))
                .then_some(name.clone())
        })
        .collect()
}

#[test]
fn a_new_lowercase_root_leaf_is_not_a_generated_namespace_exception() {
    let directory = tempfile::tempdir().unwrap();
    std::fs::write(
        directory.path().join("lib.rs"),
        format!("{} pub fn append() {{}}", generated_source("")),
    )
    .unwrap();
    let program = source::load_crates(&[CrateInput {
        name: "fixture".into(),
        root: directory.path().join("lib.rs"),
        dependencies: [("sea_orm".into(), "sea-orm".into())].into(),
    }]);
    assert_eq!(
        resolved_namespace_names(&program, "fixture", &["entity".to_owned()].into()),
        ["entity".to_owned()].into()
    );
}

#[test]
fn compile_evidence_runs_the_exact_successful_test_and_rejects_empty_or_failing_runs() {
    let directory = tempfile::tempdir().unwrap();
    std::fs::create_dir(directory.path().join("tests")).unwrap();
    std::fs::write(
        directory.path().join("Cargo.toml"),
        "[package]\nname=\"compiler-evidence\"\nversion=\"0.0.0\"\nedition=\"2021\"\n[workspace]\n",
    )
    .unwrap();
    std::fs::write(
        directory.path().join("Cargo.lock"),
        "version = 4\n[[package]]\nname = \"compiler-evidence\"\nversion = \"0.0.0\"\n",
    )
    .unwrap();
    std::fs::write(directory.path().join("tests/probe.rs"), "#[test] fn supported() {} #[test] fn broken() { panic!(\"explicit compiler probe failure\"); }").unwrap();
    let mut exception = generated_exception();
    exception.compile_evidence = CompileEvidence {
        manifest: directory.path().join("Cargo.toml"),
        test_target: "probe".into(),
        test_filter: "supported".into(),
    };
    assert!(super::super::exceptions::verify_compile_evidence(&exception).is_ok());
    exception.compile_evidence.test_filter = "missing_test".into();
    assert!(
        super::super::exceptions::verify_compile_evidence(&exception)
            .unwrap_err()
            .contains("0 passed")
    );
    exception.compile_evidence.test_filter = "broken".into();
    assert!(
        super::super::exceptions::verify_compile_evidence(&exception)
            .unwrap_err()
            .contains("explicit compiler probe failure")
    );
}

#[test]
fn generated_inventory_refresh_requires_executed_compile_evidence_before_writing() {
    let directory = tempfile::tempdir().unwrap();
    std::fs::create_dir(directory.path().join("tests")).unwrap();
    std::fs::write(
        directory.path().join("Cargo.toml"),
        "[package]\nname=\"compiler-evidence\"\nversion=\"0.0.0\"\nedition=\"2021\"\n[workspace]\n",
    )
    .unwrap();
    std::fs::write(
        directory.path().join("Cargo.lock"),
        "version = 4\n[[package]]\nname = \"compiler-evidence\"\nversion = \"0.0.0\"\n",
    )
    .unwrap();
    std::fs::write(
        directory.path().join("tests/probe.rs"),
        "#[test] fn a_different_test() {}",
    )
    .unwrap();
    std::fs::write(directory.path().join("lib.rs"), generated_source("")).unwrap();
    let program = source::load_crates(&[CrateInput {
        name: "fixture".into(),
        root: directory.path().join("lib.rs"),
        dependencies: [("sea_orm".into(), "sea-orm".into())].into(),
    }]);
    let mut exception = generated_exception();
    exception.compile_evidence = CompileEvidence {
        manifest: directory.path().join("Cargo.toml"),
        test_target: "probe".into(),
        test_filter: "missing_protecting_test".into(),
    };
    let names = directory.path().join("names.txt");
    let evidence = directory.path().join("evidence.txt");
    std::fs::write(&names, "reviewed named approvals").unwrap();
    std::fs::write(&evidence, "reviewed kind/gating evidence").unwrap();
    let errors =
        policy::write_approval_files(&program, &[exception], &names, &evidence).unwrap_err();
    assert!(
        errors.iter().any(|error| error.contains("0 passed")),
        "{errors:?}"
    );
    assert_eq!(
        std::fs::read_to_string(&names).unwrap(),
        "reviewed named approvals"
    );
    assert_eq!(
        std::fs::read_to_string(&evidence).unwrap(),
        "reviewed kind/gating evidence"
    );
}

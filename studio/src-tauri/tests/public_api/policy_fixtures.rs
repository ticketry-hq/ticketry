use super::exceptions::{CompileEvidence, GeneratedException};
use super::inventory::DescendantApproval;
use super::{
    inventory::{Approvals, RootApproval},
    model::CrateInput,
    policy, source,
};
use std::collections::BTreeMap;

fn generated_exception() -> GeneratedException {
    GeneratedException {
        crate_name: "fixture".into(), namespace: "entity".into(),
        framework_requirement: "SeaORM relations and Seaography registration require a cohesive generated entity namespace".into(),
        rejected_flat_alternatives: "Flat root Entity/Model names collide across tables; mirrored types change generated relation contracts".into(),
        smallest_namespace: "entity".into(),
        protecting_test: "generated_namespace_inventory_rejects_growth_under_unchanged_root".into(),
        compile_evidence: CompileEvidence { manifest: std::path::Path::new(file!()).parent().unwrap().join("../../Cargo.toml"), test_target: "public_api_generated_compile".into(), test_filter: "retained_generated_namespaces_compile_with_relations_and_seaography".into() },
        descendants: [("ActiveModel", "generated-struct"), ("ActiveModelEx", "generated-struct"), ("Column", "generated-enum"), ("COLUMN", "generated-const"), ("Entity", "generated-struct"), ("EntityLoader", "generated-struct"), ("EntityLoaderNest", "generated-struct"), ("EntityLoaderWith", "generated-struct"), ("EntityLoaderWithParam", "generated-trait"), ("EntityReverse", "generated-struct"), ("TypedColumn", "generated-struct"), ("Model", "struct"), ("ModelEx", "generated-struct"), ("PrimaryKey", "generated-enum"), ("RelatedEntity", "generated-enum"), ("Relation", "generated-enum")].into_iter().map(|(name, kind)| DescendantApproval { path: format!("entity::{name}"), kind: kind.into(), gates: vec![] }).collect(),
    }
}

fn generated_source(extra: &str) -> String {
    format!("mod private {{ pub mod entity {{ use sea_orm::entity::prelude::*; #[sea_orm::model] #[derive(Clone, Debug, PartialEq, Eq, DeriveEntityModel)] #[sea_orm(table_name = \"example\")] pub struct Model {{ #[sea_orm(primary_key)] pub id:i32 }} impl ActiveModelBehavior for ActiveModel {{}} {extra} }} }} pub use private::entity;")
}

#[test]
fn only_the_exact_generated_namespace_and_descendants_are_approved() {
    let directory = tempfile::tempdir().unwrap();
    std::fs::write(directory.path().join("lib.rs"), generated_source("")).unwrap();
    let program = source::load_crates(&[CrateInput {
        name: "fixture".into(),
        root: directory.path().join("lib.rs"),
        dependencies: [("sea_orm".into(), "sea-orm".into())].into(),
    }]);
    let exception = generated_exception();
    let inventory = policy::regenerate(&program, &[exception.clone()]).unwrap();
    assert_eq!(
        inventory.descendants[&("fixture".into(), "entity".into())],
        exception.descendants
    );
    assert_eq!(inventory.roots.first().unwrap().kind, "generated-namespace");
}

#[test]
fn generated_macro_leaf_exports_require_supported_compile_backed_namespace_handling() {
    let directory = tempfile::tempdir().unwrap();
    let text = generated_source("").replace(
        "pub use private::entity;",
        "pub use private::entity::Entity;",
    );
    std::fs::write(directory.path().join("lib.rs"), text).unwrap();
    let program = source::load_crates(&[CrateInput {
        name: "fixture".into(),
        root: directory.path().join("lib.rs"),
        dependencies: [("sea_orm".into(), "sea-orm".into())].into(),
    }]);
    let errors = policy::regenerate(&program, &[]).unwrap_err();
    assert!(
        errors
            .iter()
            .any(|error| error.contains("generated macro leaf")
                && error.contains("Entity")
                && error.contains("compile-backed")),
        "{errors:?}"
    );
}

#[test]
fn generated_namespace_inventory_rejects_growth_under_unchanged_root() {
    let directory = tempfile::tempdir().unwrap();
    std::fs::write(
        directory.path().join("lib.rs"),
        generated_source("pub fn helper() {} mod hidden { pub fn unreachable() {} }"),
    )
    .unwrap();
    let program = source::load_crates(&[CrateInput {
        name: "fixture".into(),
        root: directory.path().join("lib.rs"),
        dependencies: [("sea_orm".into(), "sea-orm".into())].into(),
    }]);
    let mut exception = generated_exception();
    exception.descendants.insert(DescendantApproval {
        path: "entity::helper".into(),
        kind: "fn".into(),
        gates: vec![],
    });
    let errors = policy::regenerate(&program, &[exception]).unwrap_err();
    assert!(
        errors
            .iter()
            .any(|error| error.contains("authored helper helper")),
        "{errors:?}"
    );
    assert!(
        !errors.iter().any(|error| error.contains("unreachable")),
        "private ancestors do not expose descendants: {errors:?}"
    );
}

#[test]
fn unchanged_generated_root_name_does_not_approve_new_reachable_item_alias() {
    let directory = tempfile::tempdir().unwrap();
    std::fs::write(
        directory.path().join("lib.rs"),
        generated_source("pub use self::Model as Extra;"),
    )
    .unwrap();
    let program = source::load_crates(&[CrateInput {
        name: "fixture".into(),
        root: directory.path().join("lib.rs"),
        dependencies: [("sea_orm".into(), "sea-orm".into())].into(),
    }]);
    let errors = policy::regenerate(&program, &[generated_exception()]).unwrap_err();
    assert!(
        errors.iter().any(
            |error| error.contains("exceptional descendant inventory differs")
                && error.contains("entity::Extra")
        ),
        "{errors:?}"
    );
}

#[test]
fn exceptional_descendant_inventory_audits_the_union_of_conditional_sources() {
    let directory = tempfile::tempdir().unwrap();
    let first = generated_source("")
        .replace("mod private", "mod first")
        .replace("pub use private::entity;", "");
    let second = generated_source("")
        .replace("mod private", "mod second")
        .replace("pub use private::entity;", "");
    std::fs::write(directory.path().join("lib.rs"), format!("{first} {second} #[cfg(feature = \"one\")] pub use first::entity; #[cfg(feature = \"two\")] pub use second::entity;")).unwrap();
    let program = source::load_crates(&[CrateInput {
        name: "fixture".into(),
        root: directory.path().join("lib.rs"),
        dependencies: [("sea_orm".into(), "sea-orm".into())].into(),
    }]);
    let mut exception = generated_exception();
    exception.descendants = exception
        .descendants
        .into_iter()
        .flat_map(|item| {
            [
                DescendantApproval {
                    gates: vec!["cfg (feature = \"one\")".into()],
                    ..item.clone()
                },
                DescendantApproval {
                    gates: vec!["cfg (feature = \"two\")".into()],
                    ..item
                },
            ]
        })
        .collect();
    assert!(policy::regenerate(&program, &[exception]).is_ok());
}

#[test]
fn generated_exception_rejects_stale_wildcard_and_authored_namespace_records() {
    let directory = tempfile::tempdir().unwrap();
    std::fs::write(
        directory.path().join("lib.rs"),
        "mod helper { pub struct Model; } pub use helper as entity;",
    )
    .unwrap();
    let program = source::load_crates(&[CrateInput {
        name: "fixture".into(),
        root: directory.path().join("lib.rs"),
        dependencies: BTreeMap::new(),
    }]);
    let errors = policy::regenerate(&program, &[generated_exception()]).unwrap_err();
    assert!(
        errors
            .iter()
            .any(|error| error.contains("actual SeaORM Model DeriveEntityModel")),
        "{errors:?}"
    );
    let mut wildcard = generated_exception();
    wildcard.namespace = "*".into();
    let errors = policy::regenerate(&program, &[wildcard]).unwrap_err();
    assert!(
        errors.iter().any(|error| error.contains("wildcard")),
        "{errors:?}"
    );
    assert!(
        errors.iter().any(|error| error.contains("stale or unused")),
        "{errors:?}"
    );
}

#[test]
fn regenerating_approvals_cannot_approve_a_direct_implementation_namespace() {
    let directory = tempfile::tempdir().unwrap();
    std::fs::write(
        directory.path().join("lib.rs"),
        "pub mod internals { pub fn run() {} }",
    )
    .unwrap();
    let program = source::load_crates(&[CrateInput {
        name: "fixture".into(),
        root: directory.path().join("lib.rs"),
        dependencies: BTreeMap::new(),
    }]);
    let errors = policy::regenerate(&program, &[])
        .expect_err("regeneration must apply structural policy first");
    assert!(
        errors.iter().any(
            |error| error.contains("direct public implementation module")
                && error.contains("internals")
        ),
        "{errors:?}"
    );
}

#[test]
fn an_approved_root_name_cannot_hide_an_authored_module_alias() {
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
    let errors = policy::regenerate(&program, &[])
        .expect_err("namespace remains invalid even after approving its root name");
    assert!(
        errors
            .iter()
            .any(|error| error.contains("authored module re-export")
                && error.contains("Approved")
                && error.contains("internal")),
        "{errors:?}"
    );
}

#[test]
fn named_root_approval_preserves_leaf_kind_and_feature_gating() {
    let directory = tempfile::tempdir().unwrap();
    std::fs::write(directory.path().join("lib.rs"), "mod implementation { pub fn run() {} } #[cfg(feature = \"test-support\")] pub use implementation::run as fixture_run;").unwrap();
    let program = source::load_crates(&[CrateInput {
        name: "fixture".into(),
        root: directory.path().join("lib.rs"),
        dependencies: BTreeMap::new(),
    }]);
    let inventory = policy::regenerate(&program, &[]).unwrap();
    assert_eq!(inventory.roots.len(), 1);
    let root = inventory.roots.first().unwrap();
    assert_eq!(
        (&root.crate_name, &root.name, &root.kind),
        (
            &"fixture".to_owned(),
            &"fixture_run".to_owned(),
            &"fn".to_owned()
        )
    );
    assert!(
        root.gates.iter().any(|gate| gate.contains("test-support")),
        "{root:?}"
    );
    let mut approvals = Approvals::from_inventory(&inventory);
    assert!(policy::audit(&program, &approvals, &[]).is_ok());
    approvals.roots = [RootApproval {
        kind: "struct".into(),
        ..root.clone()
    }]
    .into();
    assert!(policy::audit(&program, &approvals, &[])
        .unwrap_err()
        .iter()
        .any(|error| error.contains("kind/gating")));
}

#[path = "policy_evidence_fixtures.rs"]
mod evidence;

#[path = "policy_test_support_fixtures.rs"]
mod test_support;

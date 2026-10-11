use super::{generated_exception, generated_source, policy, source, CrateInput};

#[test]
fn regenerated_inventory_cannot_approve_a_generated_test_support_namespace() {
    for (gate_location, attribute, evidence) in [
        (
            "root",
            "cfg(feature = \"test-support\")",
            "cfg (feature = \"test-support\")",
        ),
        (
            "descendant",
            "cfg(feature = \"test-support\")",
            "cfg (feature = \"test-support\")",
        ),
        (
            "root",
            "cfg(not(feature = \"test-support\"))",
            "cfg (not (feature = \"test-support\"))",
        ),
        (
            "root",
            "cfg_attr(feature = \"test-support\", cfg(feature = \"extra\"))",
            "feature = \"test-support\" => cfg (feature = \"extra\")",
        ),
    ] {
        let directory = tempfile::tempdir().unwrap();
        let code = if gate_location == "root" {
            generated_source("").replace(
                "pub use private::entity;",
                &format!("#[{attribute}] pub use private::entity;"),
            )
        } else {
            generated_source("").replace(
                "#[sea_orm::model]",
                &format!("#[{attribute}] #[sea_orm::model]"),
            )
        };
        std::fs::write(directory.path().join("lib.rs"), code).unwrap();
        let program = source::load_crates(&[CrateInput {
            name: "fixture".into(),
            root: directory.path().join("lib.rs"),
            dependencies: [("sea_orm".into(), "sea-orm".into())].into(),
        }]);
        assert!(program.diagnostics.is_empty(), "{:?}", program.diagnostics);
        for refreshed_record in [false, true] {
            let mut record = generated_exception();
            if refreshed_record {
                record.descendants = record
                    .descendants
                    .into_iter()
                    .map(|mut item| {
                        item.gates = vec![evidence.into()];
                        item
                    })
                    .collect();
            }
            let errors = policy::regenerate(&program, &[record]).expect_err(
                "even refreshed generated inventories cannot approve test-support exposure",
            );
            assert!(
                errors
                    .iter()
                    .any(|error| error.contains("test-support")
                        && error.contains("generated exception")),
                "{gate_location}, refreshed={refreshed_record}: {errors:?}"
            );
        }
    }
}

#[test]
fn a_different_feature_name_is_not_mistaken_for_test_support() {
    let directory = tempfile::tempdir().unwrap();
    let code = generated_source("").replace(
        "pub use private::entity;",
        "#[cfg(feature = \"test-support-extra\")] pub use private::entity;",
    );
    std::fs::write(directory.path().join("lib.rs"), code).unwrap();
    let program = source::load_crates(&[CrateInput {
        name: "fixture".into(),
        root: directory.path().join("lib.rs"),
        dependencies: [("sea_orm".into(), "sea-orm".into())].into(),
    }]);
    let mut record = generated_exception();
    record.descendants = record
        .descendants
        .into_iter()
        .map(|mut item| {
            item.gates = vec!["cfg (feature = \"test-support-extra\")".into()];
            item
        })
        .collect();
    assert!(policy::regenerate(&program, &[record]).is_ok());
}

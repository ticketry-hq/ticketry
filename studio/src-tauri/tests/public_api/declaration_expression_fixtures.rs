use super::{inventory::Approvals, model::CrateInput, policy, source};
use std::collections::BTreeMap;
use std::process::Command;

/// Compiles `library` as `consumer`, proves an external crate can import the
/// leaked `hidden!` root macro, then requires the scanner to fail closed while
/// approvals still name only `Approved`.
fn leaked_root_macro_is_rejected(library: &str, approved_kind: &str) {
    let directory = tempfile::tempdir().unwrap();
    let path = directory.path();
    let root = path.join("lib.rs");
    std::fs::write(&root, library).unwrap();
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
    assert!(
        program
            .diagnostics
            .iter()
            .any(|error| error.contains("unsupported") && error.contains("compile evidence")),
        "{:?}",
        program.diagnostics
    );
    let approvals = Approvals::parse(
        "consumer|Approved\n",
        &format!("consumer|Approved|{approved_kind}|\n"),
    )
    .unwrap();
    policy::audit(&program, &approvals, &[])
        .expect_err("unchanged approvals must not accept a leaked root macro");
    policy::regenerate(&program, &[])
        .expect_err("regeneration must not approve a leaked root macro");
}

const EXPORT: &str = "#[macro_export] macro_rules! hidden { () => {} }";

#[test]
fn an_enum_discriminant_cannot_conceal_an_exported_root_macro() {
    leaked_root_macro_is_rejected(
        &format!("pub enum Approved {{ Variant = {{ {EXPORT} 0 }} }}"),
        "enum",
    );
}

#[test]
fn a_type_alias_array_length_cannot_conceal_an_exported_root_macro() {
    leaked_root_macro_is_rejected(
        &format!("pub type Approved = [(); {{ {EXPORT} 0 }}];"),
        "type",
    );
}

#[test]
fn a_private_struct_field_length_cannot_conceal_an_exported_root_macro() {
    leaked_root_macro_is_rejected(
        &format!("struct Private([u8; {{ {EXPORT} 0 }}]); pub struct Approved;"),
        "struct",
    );
}

#[test]
fn a_conditional_private_union_field_cannot_conceal_an_exported_root_macro() {
    leaked_root_macro_is_rejected(
        &format!(
            "#[cfg(all())] union Private {{ field: [u8; {{ {EXPORT} 1 }}] }} pub struct Approved;"
        ),
        "struct",
    );
}

#[test]
fn a_const_generic_default_cannot_conceal_an_exported_root_macro() {
    leaked_root_macro_is_rejected(
        &format!("pub struct Approved<const N: usize = {{ {EXPORT} 0 }}>;"),
        "struct",
    );
}

#[test]
fn a_foreign_static_type_cannot_conceal_an_exported_root_macro() {
    leaked_root_macro_is_rejected(
        &format!("extern \"C\" {{ static PRIVATE: [u8; {{ {EXPORT} 0 }}]; }} pub struct Approved;"),
        "struct",
    );
}

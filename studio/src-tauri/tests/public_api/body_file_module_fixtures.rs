use super::{inventory::Approvals, model::CrateInput, policy, source};
use std::collections::BTreeMap;
use std::path::PathBuf;
use std::process::Command;

const CHILD: &str = "#[macro_export] macro_rules! leaked_file { () => {} }";

/// Compiles `library` as `consumer`. With a `child` path (relative to
/// `lib.rs`), it writes the exporting file module there and proves an
/// external crate can import and invoke its `leaked_file!` root macro.
fn compiled(library: &str, child: Option<&str>) -> (tempfile::TempDir, PathBuf) {
    let directory = tempfile::tempdir().unwrap();
    let path = directory.path();
    let root = path.join("lib.rs");
    std::fs::write(&root, library).unwrap();
    let mut commands = vec![vec![
        "lib.rs",
        "--edition=2021",
        "--crate-type=lib",
        "--crate-name=consumer",
    ]];
    if let Some(child) = child {
        let child = path.join(child);
        std::fs::create_dir_all(child.parent().unwrap()).unwrap();
        std::fs::write(child, CHILD).unwrap();
        std::fs::write(
            path.join("caller.rs"),
            "use consumer::leaked_file; fn main() { leaked_file!(); }",
        )
        .unwrap();
        commands.push(vec![
            "caller.rs",
            "--edition=2021",
            "--extern",
            "consumer=libconsumer.rlib",
        ]);
    }
    for arguments in commands {
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
    (directory, root)
}

fn load(root: PathBuf) -> super::model::Program {
    source::load_crates(&[CrateInput {
        name: "consumer".into(),
        root,
        dependencies: BTreeMap::new(),
    }])
}

/// Requires the scanner to fail closed on a compiler-confirmed file module
/// declared in a body, naming `evidence` (such as its cfg), while approvals
/// still name only `approved`.
fn body_file_module_is_rejected(library: &str, child: &str, evidence: &str) {
    let (_directory, root) = compiled(library, Some(child));
    let program = load(root);
    assert!(
        program
            .diagnostics
            .iter()
            .any(|error| error.contains("unsupported")
                && error.contains("compile evidence")
                && error.contains(evidence)),
        "{:?}",
        program.diagnostics
    );
    let approvals = Approvals::parse("consumer|approved\n", "consumer|approved|fn|\n").unwrap();
    policy::audit(&program, &approvals, &[])
        .expect_err("unchanged approvals must not accept a body file module's root macro");
    policy::regenerate(&program, &[])
        .expect_err("regeneration must not approve a body file module's root macro");
}

#[test]
fn a_path_file_module_in_a_body_cannot_conceal_an_exported_root_macro() {
    body_file_module_is_rejected(
        "pub fn approved() { #[path = \"child.rs\"] mod child; }",
        "child.rs",
        "file module",
    );
}

#[test]
fn a_cfg_gated_body_file_module_is_rejected_with_its_gating_evidence() {
    body_file_module_is_rejected(
        "pub fn approved() { #[cfg(all())] #[path = \"child.rs\"] mod child; }",
        "child.rs",
        "cfg (all ())",
    );
}

#[test]
fn a_cfg_attr_path_body_file_module_is_rejected_with_its_path_condition() {
    body_file_module_is_rejected(
        "pub fn approved() { #[cfg_attr(all(), path = \"child.rs\")] mod child; }",
        "child.rs",
        "all ()",
    );
}

#[test]
fn a_file_module_in_an_inline_body_module_cannot_conceal_an_exported_root_macro() {
    body_file_module_is_rejected(
        "pub fn approved() { mod inner { #[path = \"child.rs\"] mod child; } }",
        "inner/child.rs",
        "file module",
    );
}

#[test]
fn a_body_file_module_inherits_its_inline_ancestor_gating_evidence() {
    body_file_module_is_rejected(
        "pub fn approved() { #[cfg(all())] mod inner { #[path = \"child.rs\"] mod child; } }",
        "inner/child.rs",
        "module gating evidence: cfg (all ())",
    );
}

#[test]
fn inline_body_modules_keep_a_flat_leaf_contract() {
    let (_directory, root) = compiled(
        "pub fn approved() { mod inner { pub fn helper() {} mod deeper { fn more() {} } } inner::helper(); }",
        None,
    );
    let program = load(root);
    assert!(program.diagnostics.is_empty(), "{:?}", program.diagnostics);
    let approvals = Approvals::parse("consumer|approved\n", "consumer|approved|fn|\n").unwrap();
    policy::audit(&program, &approvals, &[]).unwrap();
}

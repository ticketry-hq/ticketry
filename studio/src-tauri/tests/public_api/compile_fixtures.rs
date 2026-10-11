use std::collections::BTreeMap;
use std::path::Path;
use std::process::{Command, Output};

use super::{inventory::Approvals, model::CrateInput, policy, source};

#[test]
fn moving_private_implementation_preserves_the_audited_external_consumer() {
    let directory = tempfile::tempdir().unwrap();
    let path = directory.path();
    std::fs::write(
        path.join("lib.rs"),
        "mod original; pub use original::run as execute;",
    )
    .unwrap();
    std::fs::write(path.join("original.rs"), "pub fn run() -> u8 { 42 }").unwrap();
    std::fs::write(
        path.join("consumer.rs"),
        "fn main() { assert_eq!(capability::execute(), 42); }",
    )
    .unwrap();
    let before = inventory(path);
    compile_consumer(path);
    std::fs::create_dir(path.join("implementation")).unwrap();
    std::fs::rename(
        path.join("original.rs"),
        path.join("implementation/moved.rs"),
    )
    .unwrap();
    std::fs::write(path.join("lib.rs"), "mod implementation { mod moved; pub use moved::run; } pub use implementation::run as execute;").unwrap();
    let after = inventory(path);
    policy::audit(&program(path), &Approvals::from_inventory(&before), &[]).unwrap();
    assert_eq!(
        before.roots, after.roots,
        "private movement preserves the caller contract"
    );
    compile_consumer(path);
    std::fs::write(
        path.join("forbidden.rs"),
        "fn main() { capability::implementation::run(); }",
    )
    .unwrap();
    let output = rustc(
        path,
        &[
            "forbidden.rs",
            "--edition=2021",
            "--extern",
            "capability=libcapability.rlib",
        ],
    );
    assert!(!output.status.success());
    let stderr = String::from_utf8_lossy(&output.stderr);
    assert!(
        stderr.contains("E0603") && stderr.contains("implementation"),
        "{stderr}"
    );
}

fn program(path: &Path) -> super::model::Program {
    source::load_crates(&[CrateInput {
        name: "capability".into(),
        root: path.join("lib.rs"),
        dependencies: BTreeMap::new(),
    }])
}

fn inventory(path: &Path) -> super::inventory::Inventory {
    policy::regenerate(&program(path), &[]).unwrap()
}

fn compile_consumer(path: &Path) {
    for arguments in [
        vec![
            "lib.rs",
            "--crate-name",
            "capability",
            "--crate-type=rlib",
            "--edition=2021",
        ],
        vec![
            "consumer.rs",
            "--edition=2021",
            "--extern",
            "capability=libcapability.rlib",
        ],
    ] {
        let output = rustc(path, &arguments);
        assert!(
            output.status.success(),
            "{}",
            String::from_utf8_lossy(&output.stderr)
        );
    }
    assert!(Command::new(path.join("consumer"))
        .status()
        .unwrap()
        .success());
}

fn rustc(path: &Path, arguments: &[&str]) -> Output {
    Command::new("rustc")
        .current_dir(path)
        .args(arguments)
        .output()
        .unwrap()
}

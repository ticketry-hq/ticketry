use super::{inventory::Approvals, model::CrateInput, policy, source};
use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::process::Command;

/// Compiles `library` as `consumer` against the shipping workspace's locked
/// Tauri artifact and proves an external crate can import `imports`.
fn external_crate_imports(library: &str, imports: &[&str]) -> (tempfile::TempDir, PathBuf) {
    let workspace = Path::new(env!("CARGO_MANIFEST_DIR"))
        .ancestors()
        .find(|path| path.join("crates/app/ticketry-desktop").is_dir())
        .expect("locate the shipping workspace from either test runner")
        .canonicalize()
        .unwrap();
    let temporary = tempfile::tempdir().unwrap();
    let directory = temporary.path();
    for (name, manifest, source) in [
        (
            "consumer",
            "[dependencies]\ntauri = \"=2.11.5\"\n".to_owned(),
            library.to_owned(),
        ),
        (
            "caller",
            "[dependencies]\nconsumer = { path = \"../consumer\" }\n".to_owned(),
            format!(
                "#[allow(unused_imports)] use consumer::{{{}}};",
                imports.join(", ")
            ),
        ),
    ] {
        std::fs::create_dir_all(directory.join(name).join("src")).unwrap();
        std::fs::write(
            directory.join(name).join("Cargo.toml"),
            format!(
                "[package]\nname = \"{name}\"\nversion = \"0.0.0\"\nedition = \"2021\"\n{manifest}"
            ),
        )
        .unwrap();
        std::fs::write(directory.join(name).join("src/lib.rs"), source).unwrap();
    }
    std::fs::write(
        directory.join("Cargo.toml"),
        "[workspace]\nresolver = \"2\"\nmembers = [\"consumer\", \"caller\"]\n",
    )
    .unwrap();
    std::fs::copy(workspace.join("Cargo.lock"), directory.join("Cargo.lock")).unwrap();
    let output = Command::new("cargo")
        .args(["check", "--offline", "-p", "caller", "--manifest-path"])
        .arg(directory.join("Cargo.toml"))
        .env("CARGO_TARGET_DIR", workspace.join("target"))
        .output()
        .unwrap();
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
    let root = directory.join("consumer/src/lib.rs");
    (temporary, root)
}

fn load(root: PathBuf) -> super::model::Program {
    source::load_crates(&[CrateInput {
        name: "consumer".into(),
        root,
        dependencies: BTreeMap::from([("tauri".into(), "tauri".into())]),
    }])
}

/// Requires the scanner to fail closed on a compiler-confirmed nested helper
/// while approvals still name only the enclosing `approved` function.
fn nested_command_helpers_are_rejected(library: &str) {
    let (_directory, root) =
        external_crate_imports(library, &["__cmd__nested", "__tauri_command_name_nested"]);
    let program = load(root);
    assert!(
        program
            .diagnostics
            .iter()
            .any(|error| error.contains("unsupported") && error.contains("compile evidence")),
        "{:?}",
        program.diagnostics
    );
    let approvals = Approvals::parse("consumer|approved\n", "consumer|approved|fn|\n").unwrap();
    policy::audit(&program, &approvals, &[])
        .expect_err("unchanged approvals must not accept nested Tauri command helpers");
    policy::regenerate(&program, &[])
        .expect_err("regeneration must not approve nested Tauri command helpers");
}

#[test]
fn a_nested_tauri_command_cannot_conceal_generated_root_helpers() {
    nested_command_helpers_are_rejected(
        "pub fn approved() { #[tauri::command] pub fn nested() {} }",
    );
}

#[test]
fn a_cfg_attr_controlled_nested_tauri_command_cannot_conceal_generated_root_helpers() {
    nested_command_helpers_are_rejected(
        "pub fn approved() { #[cfg_attr(all(), tauri::command)] pub fn nested() {} }",
    );
}

#[test]
fn a_top_level_tauri_command_keeps_its_modeled_root_helpers() {
    let (_directory, root) = external_crate_imports(
        "mod commands { #[tauri::command] pub fn approved() {} } pub use commands::approved;",
        &[
            "approved",
            "__cmd__approved",
            "__tauri_command_name_approved",
        ],
    );
    let program = load(root);
    assert!(program.diagnostics.is_empty(), "{:?}", program.diagnostics);
    let names = policy::regenerate(&program, &[])
        .unwrap()
        .roots
        .into_iter()
        .map(|item| (item.name, item.kind))
        .collect::<Vec<_>>();
    assert_eq!(
        names,
        [
            ("__cmd__approved".to_owned(), "macro".to_owned()),
            (
                "__tauri_command_name_approved".to_owned(),
                "macro".to_owned()
            ),
            ("approved".to_owned(), "fn".to_owned()),
        ]
    );
}

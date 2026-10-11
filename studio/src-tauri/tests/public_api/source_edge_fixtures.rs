use super::super::{model::CrateInput, policy, source, workspace};
use std::collections::BTreeMap;

#[test]
fn raw_module_identifiers_use_unescaped_physical_file_names() {
    let directory = tempfile::tempdir().unwrap();
    std::fs::write(
        directory.path().join("lib.rs"),
        "mod r#type; pub use r#type::Input;",
    )
    .unwrap();
    std::fs::write(directory.path().join("type.rs"), "pub struct Input;").unwrap();
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
        .any(|root| root.name == "Input" && root.kind == "struct"));
}

#[test]
fn unrenamed_workspace_dependencies_use_the_custom_library_target_name() {
    let directory = tempfile::tempdir().unwrap();
    for name in ["consumer", "provider"] {
        std::fs::create_dir(directory.path().join(name)).unwrap();
    }
    let manifest = directory.path().join("Cargo.toml");
    std::fs::write(
        &manifest,
        "[workspace]\nmembers = [\"consumer\", \"provider\"]\nresolver = \"2\"\n",
    )
    .unwrap();
    std::fs::write(directory.path().join("provider/Cargo.toml"), "[package]\nname = \"provider-package\"\nversion = \"0.0.0\"\nedition = \"2021\"\n[lib]\nname = \"provider_api\"\npath = \"lib.rs\"\n").unwrap();
    std::fs::write(directory.path().join("provider/lib.rs"), "pub fn run() {}").unwrap();
    std::fs::write(directory.path().join("consumer/Cargo.toml"), "[package]\nname = \"consumer\"\nversion = \"0.0.0\"\nedition = \"2021\"\n[lib]\npath = \"lib.rs\"\n[dependencies]\nprovider-package = { path = \"../provider\" }\n").unwrap();
    std::fs::write(
        directory.path().join("consumer/lib.rs"),
        "pub use provider_api::run as execute;",
    )
    .unwrap();
    let compiled = std::process::Command::new("cargo")
        .args(["check", "--offline", "--manifest-path"])
        .arg(&manifest)
        .output()
        .unwrap();
    assert!(
        compiled.status.success(),
        "{}",
        String::from_utf8_lossy(&compiled.stderr)
    );
    let inputs = workspace::load_workspace(&manifest).unwrap();
    let program = source::load_crates(&inputs);
    let inventory = policy::regenerate(&program, &[]).unwrap();
    assert!(inventory
        .roots
        .iter()
        .any(|root| root.crate_name == "consumer" && root.name == "execute"));
}

#[test]
fn a_registry_declaration_cannot_hide_a_patched_macro_dependency() {
    let directory = tempfile::tempdir().unwrap();
    for name in ["consumer", "caller", "patch"] {
        std::fs::create_dir(directory.path().join(name)).unwrap();
    }
    let manifest = directory.path().join("Cargo.toml");
    std::fs::write(&manifest, "[workspace]\nmembers=[\"consumer\",\"caller\"]\nexclude=[\"patch\"]\nresolver=\"2\"\n[patch.crates-io]\nserde={path=\"patch\"}\n").unwrap();
    std::fs::write(directory.path().join("patch/Cargo.toml"), "[package]\nname=\"serde\"\nversion=\"1.0.229\"\nedition=\"2021\"\n[lib]\nproc-macro=true\npath=\"lib.rs\"\n").unwrap();
    std::fs::write(directory.path().join("patch/lib.rs"), r#"extern crate proc_macro; #[proc_macro_derive(Serialize)] pub fn serialize(_:proc_macro::TokenStream)->proc_macro::TokenStream { "pub mod hidden { pub fn helper() {} }".parse().unwrap() }"#).unwrap();
    std::fs::write(directory.path().join("consumer/Cargo.toml"), "[package]\nname=\"consumer\"\nversion=\"0.0.0\"\nedition=\"2021\"\n[lib]\npath=\"lib.rs\"\n[dependencies]\nserde=\"=1.0.229\"\n").unwrap();
    std::fs::write(
        directory.path().join("consumer/lib.rs"),
        "#[derive(serde::Serialize)] pub struct Approved;",
    )
    .unwrap();
    std::fs::write(directory.path().join("caller/Cargo.toml"), "[package]\nname=\"caller\"\nversion=\"0.0.0\"\nedition=\"2021\"\n[[bin]]\nname=\"caller\"\npath=\"main.rs\"\n[dependencies]\nconsumer={path=\"../consumer\"}\n").unwrap();
    std::fs::write(
        directory.path().join("caller/main.rs"),
        "fn main() { consumer::hidden::helper(); }",
    )
    .unwrap();
    let compiled = std::process::Command::new("cargo")
        .args(["check", "--offline", "--manifest-path"])
        .arg(&manifest)
        .output()
        .unwrap();
    assert!(
        compiled.status.success(),
        "{}",
        String::from_utf8_lossy(&compiled.stderr)
    );
    let error = workspace::load_workspace(&manifest)
        .expect_err("the resolved dependency source must prove registry provenance");
    assert!(
        error.contains("serde") && error.contains("unsupported"),
        "{error}"
    );
}

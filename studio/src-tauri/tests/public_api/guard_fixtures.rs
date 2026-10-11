use super::guard;

#[test]
fn the_activation_seam_loads_real_cargo_roots_before_approval_comparison() {
    let directory = tempfile::tempdir().unwrap();
    let path = directory.path();
    std::fs::write(path.join("Cargo.toml"), "[package]\nname = \"fixture\"\nversion = \"0.0.0\"\nedition = \"2021\"\n[lib]\npath = \"lib.rs\"\n[workspace]\n").unwrap();
    std::fs::write(
        path.join("lib.rs"),
        "mod implementation { pub fn run() {} } pub use implementation as Approved;",
    )
    .unwrap();
    let errors = guard::check_workspace(
        &path.join("Cargo.toml"),
        "fixture|Approved\n",
        "fixture|Approved|module|\n",
        "[]",
    )
    .unwrap_err();
    assert!(
        errors
            .iter()
            .any(|error| error.contains("authored module re-export")),
        "{errors:?}"
    );
    std::fs::write(
        path.join("lib.rs"),
        "mod implementation { pub fn run() {} } pub use implementation::run;",
    )
    .unwrap();
    let inventory = guard::check_workspace(
        &path.join("Cargo.toml"),
        "fixture|run\n",
        "fixture|run|fn|\n",
        "[]",
    )
    .unwrap();
    assert_eq!(inventory.roots.len(), 1);
}

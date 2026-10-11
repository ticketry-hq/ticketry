//! Shipping workspace public exposure gate; all refreshes validate structure first.
#[path = "public_api/attributes.rs"]
mod attributes;
#[path = "public_api/exception_records.rs"]
mod exception_records;
#[path = "public_api/exceptions.rs"]
mod exceptions;
#[path = "public_api/guard.rs"]
mod guard;
#[path = "public_api/inventory.rs"]
mod inventory;
#[path = "public_api/model.rs"]
mod model;
#[path = "public_api/policy.rs"]
mod policy;
#[path = "public_api/resolve.rs"]
mod resolve;
#[path = "public_api/source.rs"]
mod source;
#[path = "public_api/workspace.rs"]
mod workspace;

#[test]
fn library_roots_are_the_only_public_facades() {
    let package_dir = std::path::Path::new(env!("CARGO_MANIFEST_DIR"));
    let manifest_dir = if package_dir.ends_with("public-api-fixtures") {
        package_dir.parent().unwrap().parent().unwrap()
    } else {
        package_dir
    };
    let manifest = manifest_dir.join("Cargo.toml");
    let inputs = workspace::load_workspace(&manifest).unwrap();
    assert_eq!(
        inputs.len(),
        22,
        "public API audit must scan the root and 21 crates"
    );
    let names = manifest_dir.join("tests/fixtures/public-api.txt");
    let evidence = manifest_dir.join("tests/fixtures/public-api-evidence.txt");
    let records_text = std::fs::read_to_string(
        manifest_dir.join("tests/fixtures/public-api-generated-exceptions.json"),
    )
    .unwrap();
    if std::env::var_os("UPDATE_PUBLIC_API").is_some() {
        let program = source::load_crates(&inputs);
        let records = exception_records::parse(&records_text, manifest_dir).unwrap();
        let actual = policy::regenerate(&program, &records)
            .unwrap_or_else(|errors| panic!("{}", errors.join("\n")));
        let reviewed = std::fs::read_to_string(&names)
            .unwrap()
            .lines()
            .map(str::trim)
            .filter(|line| !line.is_empty() && !line.starts_with('#'))
            .map(|line| {
                let (krate, name) = line.split_once('|').expect("valid reviewed root name");
                (krate.to_owned(), name.to_owned())
            })
            .collect::<std::collections::BTreeSet<_>>();
        let resolved = actual
            .roots
            .iter()
            .map(|root| (root.crate_name.clone(), root.name.clone()))
            .collect::<std::collections::BTreeSet<_>>();
        assert_eq!(
            resolved, reviewed,
            "workspace approval refresh requires review of named additions and removals first"
        );
        eprintln!("Reviewed workspace structure: {} Cargo library roots, {} exact root declarations; named set unchanged from reviewed approvals", inputs.len(), actual.roots.len());
        policy::write_approval_files(&program, &records, &names, &evidence)
            .unwrap_or_else(|errors| panic!("{}", errors.join("\n")));
    } else {
        guard::check_workspace(
            &manifest,
            &std::fs::read_to_string(names).unwrap(),
            &std::fs::read_to_string(evidence).unwrap_or_default(),
            &records_text,
        )
        .unwrap_or_else(|errors| panic!("{}", errors.join("\n")));
    }
}

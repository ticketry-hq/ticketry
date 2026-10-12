use std::collections::{BTreeMap, BTreeSet};
use std::fs;
use std::path::{Path, PathBuf};

const TIERS: [(&str, u8); 6] = [
    ("foundation", 0),
    ("config", 1),
    ("worktracking", 2),
    ("execution", 3),
    ("surfaces", 4),
    ("app", 5),
];

const EXPECTED_CRATES: [&str; 23] = [
    "tauri-graphql",
    "ticketry-agent-execution",
    "ticketry-codex-app-server",
    "ticketry-data-directory",
    "ticketry-desktop",
    "ticketry-dev-tools",
    "ticketry-diagnostics",
    "ticketry-documents",
    "ticketry-edition",
    "ticketry-entities",
    "ticketry-graphql-schema",
    "ticketry-hook",
    "ticketry-installation",
    "ticketry-launch",
    "ticketry-mcp",
    "ticketry-planner",
    "ticketry-provider",
    "ticketry-runs",
    "ticketry-settings",
    "ticketry-terminal",
    "ticketry-tool-discovery",
    "ticketry-work-management",
    "ticketry-workspace-runtime",
];

#[derive(Debug)]
struct WorkspaceCrate {
    manifest: PathBuf,
    tier: String,
    rank: u8,
    dependencies: BTreeSet<String>,
}

fn package_name(manifest: &Path, source: &str) -> String {
    let mut in_package = false;
    for line in source.lines() {
        let line = line.trim();
        if line.starts_with('[') {
            in_package = line == "[package]";
            continue;
        }
        if in_package {
            if let Some(name) = line
                .strip_prefix("name = \"")
                .and_then(|name| name.strip_suffix('"'))
            {
                return name.to_owned();
            }
        }
    }
    panic!("{} has no [package] name", manifest.display());
}

fn dependency_names(source: &str) -> BTreeSet<String> {
    let mut dependencies = BTreeSet::new();
    let mut in_dependencies = false;
    for line in source.lines() {
        let line = line.trim();
        if line.starts_with('[') {
            in_dependencies = matches!(line, "[dependencies]" | "[dev-dependencies]");
            continue;
        }
        if !in_dependencies || line.is_empty() || line.starts_with('#') {
            continue;
        }
        if let Some((name, _)) = line.split_once('=') {
            dependencies.insert(name.trim().trim_matches('"').to_owned());
        }
    }
    dependencies
}

fn workspace_crates() -> BTreeMap<String, WorkspaceCrate> {
    let crates_directory = Path::new(env!("CARGO_MANIFEST_DIR")).join("crates");
    let ranks: BTreeMap<&str, u8> = TIERS.into_iter().collect();
    let mut crates = BTreeMap::new();

    for tier_entry in fs::read_dir(&crates_directory)
        .unwrap_or_else(|error| panic!("read {}: {error}", crates_directory.display()))
    {
        let tier_path = tier_entry.expect("read tier entry").path();
        if !tier_path.is_dir() || !contains_crate_manifest(&tier_path) {
            continue;
        }
        let tier = tier_path
            .file_name()
            .and_then(|name| name.to_str())
            .expect("tier directory has a UTF-8 name");
        let rank = *ranks
            .get(tier)
            .unwrap_or_else(|| panic!("unknown crate tier: {tier}"));

        for crate_entry in fs::read_dir(&tier_path)
            .unwrap_or_else(|error| panic!("read {}: {error}", tier_path.display()))
        {
            let crate_path = crate_entry.expect("read crate entry").path();
            if !crate_path.is_dir() {
                continue;
            }
            let manifest = crate_path.join("Cargo.toml");
            assert!(
                manifest.is_file(),
                "crate directory has no Cargo.toml: {}",
                crate_path.display()
            );
            let source = fs::read_to_string(&manifest)
                .unwrap_or_else(|error| panic!("read {}: {error}", manifest.display()));
            let name = package_name(&manifest, &source);
            let previous = crates.insert(
                name.clone(),
                WorkspaceCrate {
                    manifest,
                    tier: tier.to_owned(),
                    rank,
                    dependencies: dependency_names(&source),
                },
            );
            assert!(previous.is_none(), "duplicate workspace package: {name}");
        }
    }
    crates
}

fn contains_crate_manifest(tier_path: &Path) -> bool {
    fs::read_dir(tier_path)
        .unwrap_or_else(|error| panic!("read {}: {error}", tier_path.display()))
        .filter_map(Result::ok)
        .map(|entry| entry.path())
        .any(|path| path.is_dir() && path.join("Cargo.toml").is_file())
}

#[test]
fn workspace_crates_follow_the_tier_layout() {
    let crates = workspace_crates();
    let actual: BTreeSet<&str> = crates.keys().map(String::as_str).collect();
    let expected: BTreeSet<&str> = EXPECTED_CRATES.into_iter().collect();
    assert_eq!(actual, expected, "workspace crate set changed");

    let mut violations = Vec::new();
    for (name, workspace_crate) in &crates {
        for dependency in &workspace_crate.dependencies {
            let Some(dependency_crate) = crates.get(dependency) else {
                continue;
            };
            if dependency_crate.rank > workspace_crate.rank {
                violations.push(format!(
                    "{name} ({}) depends upward on {dependency} ({}) in {}",
                    workspace_crate.tier,
                    dependency_crate.tier,
                    workspace_crate.manifest.display(),
                ));
            }
        }
    }

    assert!(
        violations.is_empty(),
        "crate tier dependencies must stay within a tier or point downward:\n{}",
        violations.join("\n")
    );
}

/// CODING-2851: `ticketry-edition` alone declares and reads `edition-core`;
/// the root package and the developer tools only forward it there.
#[test]
fn only_the_edition_crate_reads_the_edition_feature() {
    const FEATURE: &str = "edition-core";
    const FORWARD: &str = "edition-core = [\"ticketry-edition/edition-core\"]";
    let root = Path::new(env!("CARGO_MANIFEST_DIR"));
    let mut manifests: Vec<(String, PathBuf)> = workspace_crates()
        .into_iter()
        .map(|(name, workspace_crate)| (name, workspace_crate.manifest))
        .collect();
    manifests.push(("ticketry".to_owned(), root.join("Cargo.toml")));

    let mut mentions = BTreeMap::new();
    for (name, manifest) in manifests {
        let source = fs::read_to_string(&manifest)
            .unwrap_or_else(|error| panic!("read {}: {error}", manifest.display()));
        let declarations: Vec<String> = source
            .lines()
            .map(str::trim)
            .filter(|line| line.starts_with(FEATURE))
            .map(str::to_owned)
            .collect();
        if source.contains(FEATURE) {
            mentions.insert(name, declarations);
        }
    }
    let expected = BTreeMap::from([
        ("ticketry".to_owned(), vec![FORWARD.to_owned()]),
        ("ticketry-dev-tools".to_owned(), vec![FORWARD.to_owned()]),
        (
            "ticketry-edition".to_owned(),
            vec!["edition-core = []".to_owned()],
        ),
    ]);
    assert_eq!(
        mentions, expected,
        "only these manifests may name {FEATURE}"
    );

    let edition_crate = root.join("crates/foundation/ticketry-edition");
    let mut readers = Vec::new();
    for directory in [root.join("src"), root.join("crates")] {
        collect_feature_readers(&directory, &edition_crate, &mut readers);
    }
    assert!(
        readers.is_empty(),
        "only ticketry-edition may test the {FEATURE} feature:\n{}",
        readers.join("\n")
    );
}

fn collect_feature_readers(directory: &Path, edition_crate: &Path, readers: &mut Vec<String>) {
    for entry in fs::read_dir(directory)
        .unwrap_or_else(|error| panic!("read {}: {error}", directory.display()))
    {
        let path = entry.expect("read source entry").path();
        if path == edition_crate || path.ends_with("target") {
            continue;
        }
        if path.is_dir() {
            collect_feature_readers(&path, edition_crate, readers);
        } else if path.extension().is_some_and(|extension| extension == "rs") {
            let source = fs::read_to_string(&path)
                .unwrap_or_else(|error| panic!("read {}: {error}", path.display()));
            if source.contains("\"edition-core\"") {
                readers.push(path.display().to_string());
            }
        }
    }
}

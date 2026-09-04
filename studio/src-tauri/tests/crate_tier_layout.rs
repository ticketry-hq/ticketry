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

const EXPECTED_CRATES: [&str; 18] = [
    "tauri-graphql",
    "ticketry-agent-execution",
    "ticketry-data-directory",
    "ticketry-desktop",
    "ticketry-dev-tools",
    "ticketry-diagnostics",
    "ticketry-documents",
    "ticketry-entities",
    "ticketry-graphql-schema",
    "ticketry-installation",
    "ticketry-launch",
    "ticketry-mcp",
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
        if !tier_path.is_dir() {
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

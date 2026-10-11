use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::process::{Command, Output};

use serde_json::Value;

pub const FIXTURE_ITEMS: [&str; 3] = [
    "create_module_link_test_link",
    "create_module_link_test_module",
    "install_module_link_test_schema",
];

pub struct Consumer {
    directory: tempfile::TempDir,
    dependencies: PathBuf,
    artifacts: BTreeMap<String, PathBuf>,
}

impl Consumer {
    pub fn build(test_support: bool) -> Self {
        let directory = tempfile::tempdir().unwrap();
        let workspace = Path::new(env!("CARGO_MANIFEST_DIR"))
            .ancestors()
            .find(|path| {
                path.join("crates/worktracking/ticketry-work-management")
                    .is_dir()
            })
            .expect("locate the shipping workspace from either test runner")
            .canonicalize()
            .unwrap();
        let target = workspace.join("target");
        let features = if test_support {
            ", features = [\"test-support\"]"
        } else {
            ""
        };
        let work_management = workspace.join("crates/worktracking/ticketry-work-management");
        let workspace_runtime = workspace.join("crates/execution/ticketry-workspace-runtime");
        let execution = workspace.join("crates/execution/ticketry-agent-execution");
        let entities = workspace.join("crates/foundation/ticketry-entities");
        let runs = workspace.join("crates/worktracking/ticketry-runs");
        std::fs::write(directory.path().join("Cargo.toml"), format!(
            "[package]\nname = \"external-facade-consumer\"\nversion = \"0.0.0\"\nedition = \"2021\"\n[workspace]\nresolver = \"2\"\n[dependencies]\nticketry-work-management = {{ path = {:?}{features} }}\nticketry-workspace-runtime = {{ path = {:?} }}\nticketry-agent-execution = {{ path = {:?} }}\nticketry-entities = {{ path = {:?} }}\nticketry-runs = {{ path = {:?} }}\n[profile.dev]\ndebug = \"line-tables-only\"\nincremental = false\n[profile.dev.package.\"*\"]\ndebug = false\n",
            work_management, workspace_runtime, execution, entities, runs,
        )).unwrap();
        std::fs::copy(
            workspace.join("Cargo.lock"),
            directory.path().join("Cargo.lock"),
        )
        .unwrap();
        std::fs::create_dir(directory.path().join("src")).unwrap();
        std::fs::write(directory.path().join("src/lib.rs"), "use ticketry_work_management::{CommandError, ModuleLinkStore, create_work_item}; use ticketry_workspace_runtime::{WorktreeStatusService, register_workspace_worktree_graphql};").unwrap();
        let output = Command::new("cargo")
            .args(["check", "--offline", "--message-format=json"])
            .arg("--manifest-path")
            .arg(directory.path().join("Cargo.toml"))
            .env("CARGO_TARGET_DIR", &target)
            .output()
            .unwrap();
        assert_success(&output);
        let mut artifacts = BTreeMap::new();
        for line in String::from_utf8_lossy(&output.stdout).lines() {
            let Ok(message) = serde_json::from_str::<Value>(line) else {
                continue;
            };
            if message["reason"] != "compiler-artifact" {
                continue;
            }
            let name = message["target"]["name"].as_str().unwrap();
            if ![
                "ticketry_work_management",
                "ticketry_workspace_runtime",
                "ticketry_agent_execution",
                "ticketry_entities",
                "ticketry_runs",
            ]
            .contains(&name)
            {
                continue;
            }
            if name == "ticketry_work_management" {
                let features = message["features"].as_array().unwrap();
                assert_eq!(
                    features.iter().any(|feature| feature == "test-support"),
                    test_support,
                    "external graph must not unify shipping dev-dependency features: {message}"
                );
            }
            let metadata = message["filenames"]
                .as_array()
                .unwrap()
                .iter()
                .filter_map(Value::as_str)
                .find(|path| path.ends_with(".rmeta"))
                .unwrap();
            artifacts.insert(name.to_owned(), PathBuf::from(metadata));
        }
        assert_eq!(
            artifacts.len(),
            5,
            "all five real facade artifacts are required"
        );
        Self {
            directory,
            dependencies: target.join("debug/deps"),
            artifacts,
        }
    }

    pub fn accept_approved_roots(&self, test_support: bool) {
        let inventory = include_str!("../fixtures/public-api.txt");
        for name in [
            "ticketry-work-management",
            "ticketry-workspace-runtime",
            "ticketry-agent-execution",
            "ticketry-entities",
            "ticketry-runs",
        ] {
            let items: Vec<_> = inventory
                .lines()
                .filter_map(|line| line.split_once('|'))
                .filter(|(owner, item)| {
                    *owner == name && (test_support || !FIXTURE_ITEMS.contains(item))
                })
                .map(|(_, item)| item)
                .collect();
            assert!(!items.is_empty(), "missing approved scoped facade: {name}");
            let source = format!(
                "#[allow(unused_imports)] use {}::{{{}}};\n",
                name.replace('-', "_"),
                items.join(", ")
            );
            assert_success(&self.compile(&source));
        }
    }

    pub fn accept_import(&self, import: &str) {
        assert_success(&self.compile(&format!("use {import};")));
    }

    pub fn reject_import(&self, import: &str, expected_item: &str) {
        let output = self.compile(&format!("use {import};"));
        assert!(
            !output.status.success(),
            "former import still compiled: {import}"
        );
        let errors: Vec<Value> = String::from_utf8_lossy(&output.stderr)
            .lines()
            .filter_map(|line| serde_json::from_str::<Value>(line).ok())
            .filter(|message| {
                message["level"] == "error"
                    && !message["message"]
                        .as_str()
                        .unwrap_or_default()
                        .starts_with("aborting due to")
            })
            .collect();
        assert!(
            !errors.is_empty(),
            "missing compiler diagnostic: {output:?}"
        );
        for error in errors {
            let code = error["code"]["code"].as_str();
            assert!(
                matches!(code, Some("E0603" | "E0432")),
                "incidental failure: {error}"
            );
            assert!(
                error["message"].as_str().unwrap().contains(expected_item),
                "wrong rejected item: {error}"
            );
            assert!(
                error["spans"]
                    .as_array()
                    .unwrap()
                    .iter()
                    .any(|span| span["file_name"].as_str().unwrap().ends_with("probe.rs")),
                "failure must come from the external import: {error}"
            );
        }
    }

    fn compile(&self, source: &str) -> Output {
        let path = self.directory.path();
        std::fs::write(path.join("probe.rs"), source).unwrap();
        let mut command = Command::new("rustc");
        command
            .current_dir(path)
            .args([
                "probe.rs",
                "--crate-type=lib",
                "--edition=2021",
                "--emit=metadata",
                "--error-format=json",
            ])
            .arg("-L")
            .arg(format!("dependency={}", self.dependencies.display()));
        for (name, artifact) in &self.artifacts {
            command
                .arg("--extern")
                .arg(format!("{name}={}", artifact.display()));
        }
        command.output().unwrap()
    }
}

fn assert_success(output: &Output) {
    assert!(output.status.success(), "external dependencies and approved root imports must compile before negative probes\n{}\n{}", compiler_output(&output.stdout), compiler_output(&output.stderr));
}

fn compiler_output(bytes: &[u8]) -> String {
    String::from_utf8_lossy(bytes)
        .lines()
        .filter_map(|line| match serde_json::from_str::<Value>(line) {
            Ok(message) => {
                let diagnostic = if message["reason"] == "compiler-message" {
                    &message["message"]
                } else {
                    &message
                };
                diagnostic["rendered"].as_str().map(str::to_owned)
            }
            Err(_) => Some(line.to_owned()),
        })
        .collect::<Vec<_>>()
        .join("\n")
}

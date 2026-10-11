use std::os::unix::fs::PermissionsExt;
use std::process::Command;

use super::compile;

#[test]
fn every_conditional_framework_and_macro_owner_edge_requires_supported_origin() {
    let directory = tempfile::tempdir().unwrap();
    let bin = directory.path().join("bin");
    std::fs::create_dir(&bin).unwrap();
    let base = std::path::Path::new(file!())
        .parent()
        .unwrap()
        .canonicalize()
        .unwrap();
    let driver = directory.path().join("driver.rs");
    std::fs::write(
        &driver,
        format!(
            r#"
        #[path="{}/model.rs"] mod model;
        #[path="{}/workspace.rs"] mod workspace;
        fn main() {{
            let manifest = std::env::args().nth(1).unwrap();
            match workspace::load_workspace(std::path::Path::new(&manifest)) {{
                Ok(_) => println!("supported"),
                Err(error) => {{ eprintln!("{{error}}"); std::process::exit(1); }}
            }}
        }}
    "#,
            base.display(),
            base.display()
        ),
    )
    .unwrap();
    let dependencies = std::env::current_exe()
        .unwrap()
        .parent()
        .unwrap()
        .to_owned();
    let serde = std::fs::read_dir(&dependencies)
        .unwrap()
        .map(|entry| entry.unwrap().path())
        .find(|path| {
            path.file_name()
                .unwrap()
                .to_string_lossy()
                .starts_with("libserde_json-")
                && path
                    .extension()
                    .is_some_and(|extension| extension == "rlib")
        })
        .unwrap();
    let extern_json = format!("serde_json={}", serde.display());
    let search_path = format!("dependency={}", dependencies.display());
    let output = compile(
        &[
            driver.to_str().unwrap(),
            "--extern",
            &extern_json,
            "-L",
            &search_path,
        ],
        directory.path(),
    );
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
    let registry = "registry+https://github.com/rust-lang/crates.io-index";
    let package = |id: &str, name: &str, version: &str| {
        serde_json::json!({
            "id":id, "name":name, "version":version, "source":registry
        })
    };
    let root = serde_json::json!({"id":"fixture", "name":"fixture", "dependencies":[
        {"name":"serde", "rename":null, "source":registry}
    ], "targets":[{"kind":["lib"], "name":"fixture", "src_path":"/fixture/lib.rs"}]});
    let no_deps = serde_json::json!({"workspace_members":["fixture"], "packages":[root.clone()]});
    let first_metadata = directory.path().join("roots.json");
    let full_metadata = directory.path().join("resolved.json");
    std::fs::write(&first_metadata, no_deps.to_string()).unwrap();
    let cargo = bin.join("cargo");
    std::fs::write(&cargo, format!("#!/bin/sh\ncase \" $* \" in\n*' --no-deps '*) /bin/cat '{}' ;;\n*) /bin/cat '{}' ;;\nesac\n", first_metadata.display(), full_metadata.display())).unwrap();
    std::fs::set_permissions(&cargo, std::fs::Permissions::from_mode(0o755)).unwrap();
    for (framework_alternative, owner_alternative) in [(false, false), (true, false), (false, true)]
    {
        let mut aliases = vec![serde_json::json!({"name":"serde", "pkg":"serde-good"})];
        if framework_alternative {
            aliases.push(serde_json::json!({"name":"serde", "pkg":"serde-bad"}));
        }
        let mut owners = vec![serde_json::json!({"name":"serde_derive", "pkg":"owner-good"})];
        if owner_alternative {
            owners.push(serde_json::json!({"name":"serde_derive", "pkg":"owner-bad"}));
        }
        let metadata = serde_json::json!({
            "workspace_members":["fixture"],
            "packages":[root.clone(), package("serde-good","serde","1.0.229"),
                package("serde-bad","serde","1.0.228"), package("owner-good","serde_derive","1.0.229"),
                package("owner-bad","serde_derive","1.0.228")],
            "resolve":{"nodes":[{"id":"fixture","deps":aliases}, {"id":"serde-good","deps":owners},
                {"id":"serde-bad","deps":[]}]}
        });
        std::fs::write(&full_metadata, metadata.to_string()).unwrap();
        let output = Command::new(directory.path().join("driver"))
            .arg(directory.path().join("Cargo.toml"))
            .env("PATH", &bin)
            .output()
            .unwrap();
        if framework_alternative || owner_alternative {
            assert!(
                !output.status.success(),
                "an unsupported conditional source cannot be hidden by the first supported edge"
            );
            assert!(
                String::from_utf8_lossy(&output.stderr)
                    .contains("unsupported resolved macro dependency"),
                "{}",
                String::from_utf8_lossy(&output.stderr)
            );
        } else {
            assert!(
                output.status.success(),
                "{}",
                String::from_utf8_lossy(&output.stderr)
            );
        }
    }
}

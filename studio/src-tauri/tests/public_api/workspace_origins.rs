use std::collections::BTreeMap;
use std::path::Path;

use serde_json::Value;

use super::{array, string, CrateInput};

pub(super) fn verify(manifest: &Path, roots: &[CrateInput]) -> Result<(), String> {
    if !roots.iter().any(|root| {
        root.dependencies
            .values()
            .any(|package| reviewed_package(package))
    }) {
        return Ok(());
    }
    let output = std::process::Command::new("cargo")
        .args([
            "metadata",
            "--locked",
            "--all-features",
            "--format-version",
            "1",
            "--manifest-path",
        ])
        .arg(manifest)
        .output()
        .map_err(|error| format!("cannot verify resolved macro dependencies: {error}"))?;
    if !output.status.success() {
        return Err(format!(
            "cannot verify resolved macro dependencies with locked Cargo metadata: {}",
            String::from_utf8_lossy(&output.stderr)
        ));
    }
    let metadata: Value =
        serde_json::from_slice(&output.stdout).map_err(|error| error.to_string())?;
    let packages = array(&metadata, "packages")?
        .iter()
        .map(|package| Ok((string(package, "id")?, package)))
        .collect::<Result<BTreeMap<_, _>, String>>()?;
    let resolve = metadata
        .get("resolve")
        .ok_or("Cargo metadata has no resolved macro graph")?;
    let nodes = array(resolve, "nodes")?
        .iter()
        .map(|node| Ok((string(node, "id")?, node)))
        .collect::<Result<BTreeMap<_, _>, String>>()?;
    for member in array(&metadata, "workspace_members")? {
        let id = member
            .as_str()
            .ok_or("Cargo workspace member must be a string")?;
        let package = packages
            .get(id)
            .ok_or("resolved workspace package missing")?;
        let Some(root) = roots
            .iter()
            .find(|root| root.name == string(package, "name").unwrap_or(""))
        else {
            continue;
        };
        let node = nodes
            .get(id)
            .ok_or("resolved workspace dependency node missing")?;
        for (alias, name) in &root.dependencies {
            if !reviewed_package(name) {
                continue;
            }
            let dependencies = array(node, "deps")?
                .iter()
                .filter(|dependency| dependency.get("name").and_then(Value::as_str) == Some(alias))
                .collect::<Vec<_>>();
            if dependencies.is_empty() {
                return Err(format!("unsupported unresolved canonical macro dependency {}::{alias}; require explicit handling and compile evidence", root.name));
            }
            for dependency in dependencies {
                let dependency_id = string(dependency, "pkg")?;
                let dependency_package = packages
                    .get(dependency_id)
                    .ok_or("resolved macro package missing")?;
                registry_package(dependency_package, name)?;
                for owner in macro_owners(name) {
                    let mut pending = vec![dependency_id];
                    let mut visited = std::collections::BTreeSet::new();
                    let mut found = false;
                    while let Some(id) = pending.pop() {
                        if !visited.insert(id) {
                            continue;
                        }
                        let package = packages
                            .get(id)
                            .ok_or("resolved macro owner package missing")?;
                        if package.get("name").and_then(Value::as_str) == Some(*owner) {
                            registry_package(package, owner)?;
                            found = true;
                            continue;
                        }
                        let node = nodes
                            .get(id)
                            .ok_or("resolved macro dependency node missing")?;
                        for dependency in array(node, "deps")? {
                            pending.push(string(dependency, "pkg")?);
                        }
                    }
                    if !found {
                        return Err(format!(
                            "unsupported unresolved macro owner {owner}; require compile evidence"
                        ));
                    }
                }
            }
        }
    }
    Ok(())
}

fn registry_package(package: &Value, expected: &str) -> Result<(), String> {
    let version = match expected {
        "serde" | "serde_derive" => "1.0.229",
        "sea-orm" | "sea-orm-macros" | "sea-orm-migration" => "2.0.1",
        "seaography" | "seaography-macros" => "2.0.0-rc.9",
        "async-trait" => "0.1.92",
        "async-graphql" => "7.0.19",
        "async-graphql-derive" => "7.2.1",
        "tokio" => "1.53.1",
        "tokio-macros" => "2.7.2",
        "tauri" => "2.11.5",
        "tauri-macros" => "2.6.3",
        "taurpc" | "taurpc-macros" => "0.8.2",
        "schemars" | "schemars_derive" => "1.2.1",
        "serde_json" => "1.0.151",
        _ => return Err(format!("unreviewed macro package {expected}")),
    };
    if string(package, "name")? != expected
        || package.get("source").and_then(Value::as_str)
            != Some("registry+https://github.com/rust-lang/crates.io-index")
        || string(package, "version")? != version
    {
        return Err(format!("unsupported resolved macro dependency {expected}: require reviewed crates.io registry version {version} and compile evidence"));
    }
    Ok(())
}

pub(super) fn reviewed_package(package: &str) -> bool {
    matches!(
        package,
        "serde"
            | "sea-orm"
            | "sea-orm-migration"
            | "seaography"
            | "async-trait"
            | "async-graphql"
            | "tokio"
            | "tauri"
            | "taurpc"
            | "schemars"
            | "serde_json"
    )
}

fn macro_owners(package: &str) -> &[&str] {
    match package {
        "serde" => &["serde_derive"],
        "sea-orm" => &["sea-orm-macros", "async-trait"],
        "sea-orm-migration" => &["sea-orm-macros"],
        "seaography" => &["seaography-macros", "async-graphql", "async-graphql-derive"],
        "async-graphql" => &["async-graphql-derive"],
        "tokio" => &["tokio-macros"],
        "tauri" => &["tauri-macros"],
        "taurpc" => &["taurpc-macros"],
        "schemars" => &["schemars_derive"],
        _ => &[],
    }
}

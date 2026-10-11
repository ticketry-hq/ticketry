use std::collections::{BTreeMap, BTreeSet};
use std::path::Path;

use serde_json::Value;

use super::model::CrateInput;

#[path = "workspace_origins.rs"]
mod workspace_origins;

pub fn from_metadata(json: &str) -> Result<Vec<CrateInput>, String> {
    let metadata: Value =
        serde_json::from_str(json).map_err(|error| format!("invalid Cargo metadata: {error}"))?;
    let members: BTreeSet<&str> = array(&metadata, "workspace_members")?
        .iter()
        .map(|value| {
            value
                .as_str()
                .ok_or("Cargo workspace member must be a string".into())
        })
        .collect::<Result<_, String>>()?;
    let mut crates = Vec::new();
    let mut library_names = BTreeMap::new();
    for package in array(&metadata, "packages")? {
        if !members.contains(string(package, "id")?) {
            continue;
        }
        for target in array(package, "targets")? {
            if is_library(target)? {
                let package_name = string(package, "name")?;
                let target_name = target
                    .get("name")
                    .and_then(Value::as_str)
                    .unwrap_or(package_name)
                    .replace('-', "_");
                if library_names
                    .insert(package_name.to_owned(), target_name)
                    .is_some()
                {
                    return Err(format!(
                        "Cargo metadata has ambiguous library targets for {package_name}"
                    ));
                }
            }
        }
    }
    for package in array(&metadata, "packages")? {
        if !members.contains(string(package, "id")?) {
            continue;
        }
        let name = string(package, "name")?.to_owned();
        let mut dependencies = BTreeMap::new();
        for dependency in array(package, "dependencies")? {
            let target = string(dependency, "name")?;
            if workspace_origins::reviewed_package(target)
                && dependency.get("source").and_then(Value::as_str)
                    != Some("registry+https://github.com/rust-lang/crates.io-index")
            {
                return Err(format!("unsupported canonical macro dependency source for {target}; only the reviewed crates.io registry origin has supported expansion handling and compile evidence"));
            }
            let alias = dependency
                .get("rename")
                .and_then(Value::as_str)
                .or_else(|| library_names.get(target).map(String::as_str))
                .unwrap_or(target)
                .replace('-', "_");
            if let Some(previous) = dependencies.insert(alias.clone(), target.to_owned()) {
                if previous != target {
                    return Err(format!("Cargo metadata dependency alias {name}::{alias} has conflicting conditional targets {previous} and {target}; explicit union resolution is unsupported"));
                }
            }
        }
        for target in array(package, "targets")? {
            if is_library(target)? {
                crates.push(CrateInput {
                    name: name.clone(),
                    root: string(target, "src_path")?.into(),
                    dependencies: dependencies.clone(),
                });
            }
        }
    }
    crates.sort_by(|left, right| left.name.cmp(&right.name));
    if crates.windows(2).any(|pair| pair[0].name == pair[1].name) {
        return Err("Cargo metadata has ambiguous library package names".into());
    }
    Ok(crates)
}

fn is_library(target: &Value) -> Result<bool, String> {
    Ok(array(target, "kind")?.iter().any(|kind| {
        kind.as_str().is_some_and(|kind| {
            matches!(
                kind,
                "lib" | "rlib" | "dylib" | "cdylib" | "staticlib" | "proc-macro"
            )
        })
    }))
}

pub fn load_workspace(manifest: &Path) -> Result<Vec<CrateInput>, String> {
    let output = std::process::Command::new("cargo")
        .args([
            "metadata",
            "--format-version",
            "1",
            "--no-deps",
            "--manifest-path",
        ])
        .arg(manifest)
        .output()
        .map_err(|error| format!("cannot run Cargo metadata: {error}"))?;
    if !output.status.success() {
        return Err(format!(
            "Cargo metadata failed: {}",
            String::from_utf8_lossy(&output.stderr)
        ));
    }
    let roots =
        from_metadata(&String::from_utf8(output.stdout).map_err(|error| error.to_string())?)?;
    workspace_origins::verify(manifest, &roots)?;
    Ok(roots)
}

fn array<'a>(value: &'a Value, key: &str) -> Result<&'a Vec<Value>, String> {
    value
        .get(key)
        .and_then(Value::as_array)
        .ok_or_else(|| format!("Cargo metadata missing array `{key}`"))
}

fn string<'a>(value: &'a Value, key: &str) -> Result<&'a str, String> {
    value
        .get(key)
        .and_then(Value::as_str)
        .ok_or_else(|| format!("Cargo metadata missing string `{key}`"))
}

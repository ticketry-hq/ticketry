//! Test-internal integration seam. CODING-2653 activates this after contraction.
use std::collections::BTreeSet;
use std::path::Path;

use super::{
    exception_records, exceptions,
    inventory::{Approvals, Inventory},
    policy, source, workspace,
};

pub fn check_workspace(
    manifest: &Path,
    names: &str,
    evidence: &str,
    records: &str,
) -> Result<Inventory, Vec<String>> {
    let inputs = workspace::load_workspace(manifest).map_err(|error| vec![error])?;
    let program = source::load_crates(&inputs);
    let manifest_dir = manifest
        .parent()
        .ok_or_else(|| vec!["workspace manifest needs a parent directory".into()])?;
    let records = exception_records::parse(records, manifest_dir)?;
    let approvals = Approvals::parse(names, evidence)?;
    let inventory = policy::audit(&program, &approvals, &records)?;
    let mut checked = BTreeSet::new();
    for record in &records {
        let evidence = &record.compile_evidence;
        if checked.insert((
            &evidence.manifest,
            &evidence.test_target,
            &evidence.test_filter,
        )) {
            exceptions::verify_compile_evidence(record).map_err(|error| vec![error])?;
        }
    }
    verify_workspace_macro_evidence(&program)?;
    Ok(inventory)
}

pub(super) fn verify_workspace_macro_evidence(
    program: &super::model::Program,
) -> Result<(), Vec<String>> {
    let Some(krate) = program.crates.get("ticketry") else {
        return Ok(());
    };
    if !program.crates.contains_key("ticketry-desktop") {
        return Ok(());
    }
    let root = &program.modules[krate.root].source;
    let manifest = root
        .parent()
        .and_then(Path::parent)
        .ok_or_else(|| vec!["shipping library root needs a manifest directory".into()])?
        .join("Cargo.toml");
    let output = std::process::Command::new("cargo")
        .args(["test", "--locked", "--manifest-path"])
        .arg(manifest)
        .args([
            "-p",
            "ticketry",
            "--test",
            "public_api_workspace_macro_compile",
            "reviewed_workspace_macro_expansions_preserve_namespace_contracts",
            "--",
            "--exact",
            "--nocapture",
        ])
        .output()
        .map_err(|error| {
            vec![format!(
                "cannot run reviewed workspace macro compiler probe: {error}"
            )]
        })?;
    let stdout = String::from_utf8_lossy(&output.stdout);
    let stderr = String::from_utf8_lossy(&output.stderr);
    if !output.status.success() || !stdout.contains("1 passed") || stdout.contains("0 passed") {
        return Err(vec![format!("reviewed workspace macro compiler probe must execute the exact protecting test successfully\n{stdout}\n{stderr}")]);
    }
    Ok(())
}

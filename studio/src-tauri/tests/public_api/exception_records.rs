use super::exceptions::{CompileEvidence, GeneratedException};
use super::inventory::{parse_gates, DescendantApproval};
use serde_json::Value;
use std::path::Path;

/// The manifest directory resolves recorded compile evidence, independent of
/// whether this module is included by the isolated or shipping test harness.
pub fn parse(text: &str, manifest_dir: &Path) -> Result<Vec<GeneratedException>, Vec<String>> {
    let records: Value = serde_json::from_str(text)
        .map_err(|error| vec![format!("invalid generated exception JSON: {error}")])?;
    let entries = records.as_array().ok_or_else(|| {
        vec!["generated exception record must be an array of exact namespace records".into()]
    })?;
    let mut exceptions = Vec::new();
    let mut errors = Vec::new();
    for record in entries {
        match parse_record(record, manifest_dir) {
            Ok(exception) => exceptions.push(exception),
            Err(error) => errors.push(error),
        }
    }
    if errors.is_empty() {
        Ok(exceptions)
    } else {
        Err(errors)
    }
}

fn parse_record(record: &Value, manifest_dir: &Path) -> Result<GeneratedException, String> {
    let crate_name = field(record, "crate")?;
    let namespace = field(record, "namespace")?;
    let evidence = record
        .get("compile_evidence")
        .ok_or("missing compile_evidence")?;
    let descendants = record
        .get("descendants")
        .and_then(Value::as_array)
        .ok_or("missing exact descendants array")?;
    let mut inventory = std::collections::BTreeSet::new();
    for descendant in descendants {
        let approval = DescendantApproval {
            path: field(descendant, "path")?,
            kind: field(descendant, "kind")?,
            gates: parse_gates(&field(descendant, "gates")?),
        };
        if !inventory.insert(approval) {
            return Err(format!(
                "{crate_name}::{namespace}: duplicate descendant approval"
            ));
        }
    }
    let exception = GeneratedException {
        crate_name,
        namespace,
        framework_requirement: field(record, "framework_requirement")?,
        rejected_flat_alternatives: field(record, "rejected_flat_alternatives")?,
        smallest_namespace: field(record, "smallest_namespace")?,
        protecting_test: field(record, "protecting_test")?,
        compile_evidence: CompileEvidence {
            manifest: manifest_dir.join(field(evidence, "manifest")?),
            test_target: field(evidence, "test_target")?,
            test_filter: field(evidence, "test_filter")?,
        },
        descendants: inventory,
    };
    exception.validate().map_err(|errors| errors.join("\n"))?;
    Ok(exception)
}

fn field(record: &Value, key: &str) -> Result<String, String> {
    record
        .get(key)
        .and_then(Value::as_str)
        .map(str::to_owned)
        .ok_or_else(|| format!("generated exception record requires string {key}"))
}

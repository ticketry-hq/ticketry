use super::inventory::exact_name;
use super::inventory::DescendantApproval;
use std::collections::BTreeSet;
use std::path::PathBuf;

#[derive(Clone, Debug)]
pub struct CompileEvidence {
    pub manifest: PathBuf,
    pub test_target: String,
    pub test_filter: String,
}

#[derive(Clone, Debug)]
pub struct GeneratedException {
    pub crate_name: String,
    pub namespace: String,
    pub framework_requirement: String,
    pub rejected_flat_alternatives: String,
    pub smallest_namespace: String,
    pub protecting_test: String,
    pub compile_evidence: CompileEvidence,
    pub descendants: BTreeSet<DescendantApproval>,
}

impl GeneratedException {
    pub fn validate(&self) -> Result<(), Vec<String>> {
        let identity = format!("{}::{}", self.crate_name, self.namespace);
        let mut errors = Vec::new();
        if !exact_name(&self.crate_name) || !exact_name(&self.namespace) {
            errors.push(format!("{identity}: exception requires an exact crate and root namespace; wildcards and whole-crate exceptions are forbidden"));
        }
        if self.smallest_namespace != self.namespace {
            errors.push(format!(
                "{identity}: smallest retained namespace must equal the exact root namespace"
            ));
        }
        for (label, value) in [
            ("framework requirement", &self.framework_requirement),
            (
                "rejected flat alternatives",
                &self.rejected_flat_alternatives,
            ),
            ("protecting test", &self.protecting_test),
        ] {
            if value.trim().is_empty() {
                errors.push(format!("{identity}: exception is missing {label}"));
            }
        }
        if !self.framework_requirement.contains("SeaORM")
            || !self.framework_requirement.contains("Seaography")
        {
            errors.push(format!("{identity}: supported exception must identify the SeaORM and Seaography framework requirement"));
        }
        if !self.compile_evidence.manifest.is_file()
            || self.compile_evidence.test_target.trim().is_empty()
            || self.compile_evidence.test_filter.trim().is_empty()
        {
            errors.push(format!("{identity}: exception requires an existing compile manifest and exact protecting target/test; source auditing is not compile evidence"));
        }
        if self.descendants.is_empty() {
            errors.push(format!(
                "{identity}: exceptional descendant inventory must not be empty"
            ));
        }
        for descendant in &self.descendants {
            if test_support_gates(&descendant.gates) {
                errors.push(format!("{identity}: generated exception cannot approve test-support feature gates on {}", descendant.path));
            }
            let prefix = format!("{}::", self.namespace);
            if !descendant.path.starts_with(&prefix)
                || descendant.path.split("::").any(|part| !exact_name(part))
            {
                errors.push(format!(
                    "{identity}: invalid or wildcard descendant path {}",
                    descendant.path
                ));
            }
        }
        if errors.is_empty() {
            Ok(())
        } else {
            Err(errors)
        }
    }
}

/// Conservatively reject an exact `feature = "test-support"` predicate even
/// beneath `not`, `any`, or cfg_attr evidence; similarly named features remain
/// ordinary conditional-source evidence.
pub fn test_support_gates(gates: &[String]) -> bool {
    gates.iter().any(|gate| {
        gate.split(" => ")
            .flat_map(|part| part.split(" && "))
            .filter_map(|part| syn::parse_str::<syn::Meta>(part).ok())
            .any(|meta| test_support_meta(&meta))
    })
}

fn test_support_meta(meta: &syn::Meta) -> bool {
    use syn::parse::Parser;
    match meta {
        syn::Meta::NameValue(value) if value.path.is_ident("feature") => {
            matches!(&value.value, syn::Expr::Lit(value) if matches!(&value.lit, syn::Lit::Str(value) if value.value() == "test-support"))
        }
        syn::Meta::List(list) => {
            syn::punctuated::Punctuated::<syn::Meta, syn::Token![,]>::parse_terminated
                .parse2(list.tokens.clone())
                .map(|children| children.iter().any(test_support_meta))
                .unwrap_or(false)
        }
        _ => false,
    }
}

pub fn verify_compile_evidence(exception: &GeneratedException) -> Result<(), String> {
    exception.validate().map_err(|errors| errors.join("\n"))?;
    let evidence = &exception.compile_evidence;
    let output = std::process::Command::new("cargo")
        .args(["test", "--locked", "--manifest-path"])
        .arg(&evidence.manifest)
        .args([
            "--test",
            &evidence.test_target,
            &evidence.test_filter,
            "--",
            "--exact",
            "--nocapture",
        ])
        .output()
        .map_err(|error| format!("cannot run generated namespace compiler probe: {error}"))?;
    let stdout = String::from_utf8_lossy(&output.stdout);
    let stderr = String::from_utf8_lossy(&output.stderr);
    if !output.status.success() || !stdout.contains("1 passed") || stdout.contains("0 passed") {
        return Err(format!("{}::{}: generated namespace compiler probe must execute the exact protecting test successfully\n{stdout}\n{stderr}", exception.crate_name, exception.namespace));
    }
    Ok(())
}

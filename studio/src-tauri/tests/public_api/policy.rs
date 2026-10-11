use super::exceptions::{test_support_gates, GeneratedException};
use super::inventory::{Approvals, DescendantApproval, Inventory, RootApproval};
use super::model::{BindingKind, Program};
use super::resolve::{Resolver, Target};
use std::collections::{BTreeMap, BTreeSet};

pub fn regenerate(
    program: &Program,
    exceptions: &[GeneratedException],
) -> Result<Inventory, Vec<String>> {
    let mut errors = program.diagnostics.clone();
    let mut inventory = Inventory::default();
    let resolver = Resolver::new(program);
    let mut records = BTreeMap::new();
    let mut used = BTreeSet::new();
    for exception in exceptions {
        if let Err(mut diagnostics) = exception.validate() {
            errors.append(&mut diagnostics);
        }
        let key = (exception.crate_name.clone(), exception.namespace.clone());
        if records.insert(key.clone(), exception).is_some() {
            errors.push(format!(
                "{}::{}: duplicate generated exception",
                key.0, key.1
            ));
        }
    }
    for (crate_name, krate) in &program.crates {
        for (name, bindings) in &program.modules[krate.root].symbols {
            if !bindings.iter().any(|binding| binding.public) {
                continue;
            }
            for binding in bindings.iter().filter(|binding| binding.public) {
                if matches!(binding.kind, BindingKind::Module(_)) {
                    errors.push(format!("{crate_name}::{name}: direct public implementation module at {} (gates {:?}); use a private module and explicit leaf re-exports", binding.source, binding.gates));
                }
            }
            match resolver.resolve(krate.root, name) {
                Ok(resolved) => {
                    for item in resolved {
                        match item.target {
                        Target::Leaf { module, kind, .. } => {
                            if kind.starts_with("generated-") || !program.modules[module].expansions.is_empty() {
                                errors.push(format!("{crate_name}::{name}: generated macro leaf outside an inventoried namespace requires explicit supported compile-backed handling; target {}::{} at {} (gates {:?})", program.modules[module].crate_name, program.modules[module].logical_path.join("::"), program.modules[module].source.display(), item.gates));
                            }
                            inventory.roots.insert(RootApproval { crate_name: crate_name.clone(), name: name.clone(), kind, gates: item.gates });
                        }
                        Target::Module(module) => {
                            let key = (crate_name.clone(), name.clone());
                            if records.contains_key(&key) {
                                used.insert(key.clone());
                                match namespace_inventory(program, &resolver, module, name, &item.gates, &mut BTreeSet::new()) {
                                    Ok(descendants) => {
                                        inventory.descendants.entry(key).or_default().extend(descendants);
                                        inventory.roots.insert(RootApproval { crate_name: crate_name.clone(), name: name.clone(), kind: "generated-namespace".into(), gates: item.gates });
                                    },
                                    Err(mut diagnostics) => errors.append(&mut diagnostics),
                                }
                            } else {
                                errors.push(format!("{crate_name}::{name}: authored module re-export resolves to {}::{} at {}; export explicit leaf capabilities instead; chain: {}", program.modules[module].crate_name, program.modules[module].logical_path.join("::"), program.modules[module].source.display(), item.chain.join(" -> ")));
                            }
                        },
                        Target::Crate(target) => errors.push(format!("{crate_name}::{name}: whole-crate export of {target} is forbidden; export explicit leaf capabilities instead")),
                    }
                    }
                }
                Err(mut diagnostics) => errors.append(&mut diagnostics),
            }
        }
    }
    for (key, descendants) in &inventory.descendants {
        let exception = records[key];
        if descendants != &exception.descendants {
            errors.push(format!(
                "{}::{}: exceptional descendant inventory differs; added {:?}; removed {:?}",
                key.0,
                key.1,
                descendants
                    .difference(&exception.descendants)
                    .collect::<Vec<_>>(),
                exception
                    .descendants
                    .difference(descendants)
                    .collect::<Vec<_>>()
            ));
        }
    }
    for key in records.keys().filter(|key| !used.contains(*key)) {
        errors.push(format!(
            "{}::{}: stale or unused generated exception",
            key.0, key.1
        ));
    }
    if !errors.is_empty() {
        return Err(errors);
    }
    Ok(inventory)
}

/// Structural validation precedes all writes, including approval regeneration.
pub fn write_approval_files(
    program: &Program,
    exceptions: &[GeneratedException],
    names: &std::path::Path,
    evidence: &std::path::Path,
) -> Result<Inventory, Vec<String>> {
    let inventory = regenerate(program, exceptions)?;
    let mut verified = BTreeSet::new();
    for exception in exceptions {
        let probe = &exception.compile_evidence;
        if verified.insert((
            probe.manifest.clone(),
            probe.test_target.clone(),
            probe.test_filter.clone(),
        )) {
            super::exceptions::verify_compile_evidence(exception).map_err(|error| vec![error])?;
        }
    }
    super::guard::verify_workspace_macro_evidence(program)?;
    std::fs::write(names, inventory.names_text())
        .map_err(|error| vec![format!("cannot write {}: {error}", names.display())])?;
    std::fs::write(evidence, inventory.evidence_text())
        .map_err(|error| vec![format!("cannot write {}: {error}", evidence.display())])?;
    Ok(inventory)
}

fn namespace_inventory(
    program: &Program,
    resolver: &Resolver<'_>,
    module: usize,
    prefix: &str,
    gates: &[String],
    visited: &mut BTreeSet<usize>,
) -> Result<BTreeSet<DescendantApproval>, Vec<String>> {
    let source = &program.modules[module];
    if test_support_gates(gates) {
        return Err(vec![format!("{}::{prefix}: generated exception cannot approve a test-support feature namespace at {} (gates {:?})", source.crate_name, source.source.display(), gates)]);
    }
    if !source
        .expansions
        .iter()
        .any(|expansion| expansion == "SeaORM DeriveEntityModel")
    {
        return Err(vec![format!("{}::{prefix}: authored helper namespace cannot receive a generated exception; actual SeaORM Model DeriveEntityModel source evidence is required at {}", source.crate_name, source.source.display())]);
    }
    if !visited.insert(module) {
        return Err(vec![format!(
            "{}::{prefix}: exceptional namespace reachability cycle at {}",
            source.crate_name,
            source.source.display()
        )]);
    }
    let mut descendants = BTreeSet::new();
    let mut errors = Vec::new();
    for (name, bindings) in &source.symbols {
        if !bindings.iter().any(|binding| binding.public) {
            continue;
        }
        match resolver.resolve(module, name) {
            Ok(items) => {
                for item in items {
                    let path = format!("{prefix}::{name}");
                    let mut item_gates = gates.to_vec();
                    item_gates.extend(item.gates);
                    item_gates.sort();
                    item_gates.dedup();
                    if test_support_gates(&item_gates) {
                        errors.push(format!("{}::{path}: generated exception cannot approve test-support feature descendants (gates {:?})", source.crate_name, item_gates));
                    }
                    match item.target {
                    Target::Leaf { module: target, name: target_name, kind } => {
                        let generated = target == module && (kind.starts_with("generated-") || (target_name == "Model" && kind == "struct"));
                        if !generated { errors.push(format!("{}::{path}: authored helper {target_name} ({kind}) cannot be approved inside a generated namespace", source.crate_name)); }
                        descendants.insert(DescendantApproval { path, kind, gates: item_gates });
                    },
                    Target::Module(target) => {
                        descendants.insert(DescendantApproval { path: path.clone(), kind: "module".into(), gates: item_gates.clone() });
                        match namespace_inventory(program, resolver, target, &path, &item_gates, visited) {
                            Ok(nested) => descendants.extend(nested),
                            Err(mut diagnostics) => errors.append(&mut diagnostics),
                        }
                    },
                    Target::Crate(target) => errors.push(format!("{}::{path}: whole-crate export of {target} is forbidden inside generated namespaces", source.crate_name)),
                }
                }
            }
            Err(mut diagnostics) => errors.append(&mut diagnostics),
        }
    }
    visited.remove(&module);
    if errors.is_empty() {
        Ok(descendants)
    } else {
        Err(errors)
    }
}

pub fn audit(
    program: &Program,
    approvals: &Approvals,
    exceptions: &[GeneratedException],
) -> Result<Inventory, Vec<String>> {
    let inventory = regenerate(program, exceptions)?;
    let names = inventory
        .roots
        .iter()
        .map(|root| (root.crate_name.clone(), root.name.clone()))
        .collect();
    if approvals.names != names {
        return Err(vec![format!(
            "named root approvals differ from resolved public roots; unapproved {:?}; stale {:?}",
            names.difference(&approvals.names).collect::<Vec<_>>(),
            approvals.names.difference(&names).collect::<Vec<_>>()
        )]);
    }
    if inventory.roots != approvals.roots {
        return Err(vec![format!(
            "root kind/gating evidence differs; actual {:?}; stale {:?}",
            inventory
                .roots
                .difference(&approvals.roots)
                .collect::<Vec<_>>(),
            approvals
                .roots
                .difference(&inventory.roots)
                .collect::<Vec<_>>()
        )]);
    }
    Ok(inventory)
}

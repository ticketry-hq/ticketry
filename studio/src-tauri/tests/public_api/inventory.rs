use std::collections::{BTreeMap, BTreeSet};

#[derive(Clone, Debug, Eq, Ord, PartialEq, PartialOrd)]
pub struct RootApproval {
    pub crate_name: String,
    pub name: String,
    pub kind: String,
    pub gates: Vec<String>,
}

#[derive(Clone, Debug, Eq, Ord, PartialEq, PartialOrd)]
pub struct DescendantApproval {
    pub path: String,
    pub kind: String,
    pub gates: Vec<String>,
}

#[derive(Clone, Debug, Default, Eq, PartialEq)]
pub struct Inventory {
    pub roots: BTreeSet<RootApproval>,
    pub descendants: BTreeMap<(String, String), BTreeSet<DescendantApproval>>,
}

#[derive(Clone, Debug, Default)]
pub struct Approvals {
    pub names: BTreeSet<(String, String)>,
    pub roots: BTreeSet<RootApproval>,
}

impl Approvals {
    pub fn from_inventory(inventory: &Inventory) -> Self {
        Self {
            names: inventory
                .roots
                .iter()
                .map(|root| (root.crate_name.clone(), root.name.clone()))
                .collect(),
            roots: inventory.roots.clone(),
        }
    }

    pub fn parse(names: &str, evidence: &str) -> Result<Self, Vec<String>> {
        let mut result = Self::default();
        let mut errors = Vec::new();
        for line in records(names) {
            match line.split('|').collect::<Vec<_>>().as_slice() {
                [crate_name, name] if exact_name(crate_name) && exact_name(name) => {
                    if !result.names.insert(((*crate_name).into(), (*name).into())) {
                        errors.push(format!("duplicate named root approval: {line}"));
                    }
                }
                _ => errors.push(format!("invalid named root approval: {line}")),
            }
        }
        for line in records(evidence) {
            match line.split('|').collect::<Vec<_>>().as_slice() {
                [crate_name, name, kind, gating] if exact_name(crate_name) && exact_name(name) => {
                    let root = RootApproval {
                        crate_name: (*crate_name).into(),
                        name: (*name).into(),
                        kind: (*kind).into(),
                        gates: parse_gates(gating),
                    };
                    if !result.roots.insert(root) {
                        errors.push(format!("duplicate root evidence: {line}"));
                    }
                }
                _ => errors.push(format!("invalid root kind/gating evidence: {line}")),
            }
        }
        let evidence_names = result
            .roots
            .iter()
            .map(|root| (root.crate_name.clone(), root.name.clone()))
            .collect::<BTreeSet<_>>();
        if evidence_names != result.names {
            errors.push(
                "named root approvals and kind/gating evidence must cover exactly the same roots"
                    .into(),
            );
        }
        if errors.is_empty() {
            Ok(result)
        } else {
            Err(errors)
        }
    }
}

impl Inventory {
    pub fn names_text(&self) -> String {
        let mut text = String::from("# One `crate|exported_name` approval per public library-root item.\n# Keep entries sorted first by crate, then by exported name.\n");
        for (crate_name, name) in self
            .roots
            .iter()
            .map(|root| (&root.crate_name, &root.name))
            .collect::<BTreeSet<_>>()
        {
            text.push_str(&format!("{crate_name}|{name}\n"));
        }
        text
    }

    pub fn evidence_text(&self) -> String {
        let mut text =
            String::from("# crate|exported_name|resolved_kind|gates (semicolon-separated)\n");
        for root in &self.roots {
            text.push_str(&format!(
                "{}|{}|{}|{}\n",
                root.crate_name,
                root.name,
                root.kind,
                root.gates.join(";")
            ));
        }
        text
    }
}

pub fn records(text: &str) -> impl Iterator<Item = &str> {
    text.lines()
        .map(str::trim)
        .filter(|line| !line.is_empty() && !line.starts_with('#'))
}

pub fn exact_name(name: &str) -> bool {
    !name.is_empty() && !name.contains(['*', '|', ':', '/', '\\'])
}

pub fn parse_gates(text: &str) -> Vec<String> {
    let mut gates = text
        .split(';')
        .map(str::trim)
        .filter(|gate| !gate.is_empty())
        .map(str::to_owned)
        .collect::<Vec<_>>();
    gates.sort();
    gates.dedup();
    gates
}

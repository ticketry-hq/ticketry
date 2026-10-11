use std::path::Path;
use syn::ext::IdentExt;

use super::{attributes, public, BindingKind, Loader};

impl Loader {
    pub(super) fn child(
        &mut self,
        parent: usize,
        item: &syn::ItemMod,
        directory: &Path,
        gates: Vec<String>,
        evidence: attributes::Evidence,
    ) {
        let name = item.ident.unraw().to_string();
        let filename = item.ident.unraw().to_string();
        let ancestor = &self.program.modules[parent];
        let crate_name = ancestor.crate_name.clone();
        let mut logical_path = ancestor.logical_path.clone();
        logical_path.push(name.clone());
        let default_gates = evidence
            .paths
            .iter()
            .filter(|(_, conditions)| !conditions.is_empty())
            .map(|(_, conditions)| format!("not({})", conditions.join(" && ")))
            .collect::<Vec<_>>();
        if let Some((_, items)) = &item.content {
            let source = ancestor.source.clone();
            let unconditional = evidence
                .paths
                .iter()
                .any(|(_, conditions)| conditions.is_empty());
            let mut paths = evidence.paths;
            if !unconditional {
                paths.push((filename.clone(), default_gates));
            }
            for (path, conditions) in paths {
                let mut source_gates = gates.clone();
                source_gates.extend(conditions);
                let child = self.module(
                    &crate_name,
                    Some(parent),
                    source.clone(),
                    logical_path.clone(),
                );
                self.bind(
                    parent,
                    name.clone(),
                    public(&item.vis),
                    BindingKind::Module(child),
                    source_gates.clone(),
                );
                self.items(child, items, &directory.join(path), &source_gates);
            }
            return;
        }
        let unconditional = evidence
            .paths
            .iter()
            .any(|(_, conditions)| conditions.is_empty());
        let mut paths = evidence
            .paths
            .into_iter()
            .map(|(path, conditions)| (path, conditions, true))
            .collect::<Vec<_>>();
        if !unconditional {
            let flat = directory.join(format!("{filename}.rs"));
            let nested = directory.join(&filename).join("mod.rs");
            if flat.exists() && nested.exists() {
                self.error(
                    parent,
                    format!(
                        "ambiguous module {name}: both {} and {} exist",
                        flat.display(),
                        nested.display()
                    ),
                );
            }
            paths.push((
                if flat.exists() { flat } else { nested }
                    .to_string_lossy()
                    .into(),
                default_gates,
                false,
            ));
        }
        for (path, conditions, explicit) in paths {
            // #[path] in a conventional foo.rs resolves beside foo.rs;
            // conventional `mod child` resolves under foo/. Inline modules
            // already pass their own physical directory and keep that base.
            let physical = self.program.modules[parent].source.parent().unwrap();
            let source_stem = self.program.modules[parent].source.file_stem().unwrap();
            let explicit_base = if directory == physical.join(source_stem) {
                physical
            } else {
                directory
            };
            let path = if explicit {
                explicit_base.join(path)
            } else {
                directory.join(path)
            };
            let mut source_gates = gates.clone();
            source_gates.extend(conditions);
            let child = self.module(
                &crate_name,
                Some(parent),
                path.clone(),
                logical_path.clone(),
            );
            self.bind(
                parent,
                name.clone(),
                public(&item.vis),
                BindingKind::Module(child),
                source_gates.clone(),
            );
            let child_dir = if explicit || path.file_name().is_some_and(|name| name == "mod.rs") {
                path.parent().unwrap().to_owned()
            } else {
                path.parent().unwrap().join(path.file_stem().unwrap())
            };
            self.file(child, &path, &child_dir, &source_gates);
        }
    }
}

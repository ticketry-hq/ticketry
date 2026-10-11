//! Root effects of supported attribute expansions; conditions remain explicit.
use super::{attributes::Evidence, BindingKind, Loader};
use syn::ext::IdentExt;
use syn::{Item, Visibility};

impl Loader {
    pub(super) fn expansion_roots(
        &mut self,
        module: usize,
        item: &Item,
        evidence: &Evidence,
        gates: &[String],
    ) {
        if evidence.root_command_macros {
            match item {
                Item::Fn(function)
                    if matches!(
                        function.vis,
                        Visibility::Public(_) | Visibility::Restricted(_)
                    ) =>
                {
                    let root = self.program.crates[&self.program.modules[module].crate_name].root;
                    for (_, conditions) in evidence
                        .macro_references
                        .iter()
                        .filter(|(path, _)| path == &["tauri".to_string(), "command".to_string()])
                    {
                        let mut command_gates = gates.to_vec();
                        command_gates.extend(conditions.clone());
                        for prefix in ["__cmd__", "__tauri_command_name_"] {
                            self.bind(
                                root,
                                format!("{prefix}{}", function.sig.ident.unraw()),
                                true,
                                BindingKind::Leaf("macro".into()),
                                command_gates.to_vec(),
                            );
                        }
                    }
                }
                Item::Fn(_) => {}
                _ => self.error_under(
                    module,
                    &gates,
                    "Tauri command expansion requires a function target".into(),
                ),
            }
        }
        if evidence.mobile_entry {
            if matches!(item, Item::Fn(function) if function.sig.ident == "run") {
                let mut mobile_gates = gates.to_vec();
                mobile_gates.extend(
                    evidence
                        .macro_references
                        .iter()
                        .filter(|(path, _)| {
                            path == &["tauri".to_string(), "mobile_entry_point".to_string()]
                        })
                        .flat_map(|(_, conditions)| conditions.clone()),
                );
                mobile_gates.push("cfg (not (target_os = \"android\"))".into());
                self.bind(
                    module,
                    "start_app".into(),
                    true,
                    BindingKind::Leaf("fn".into()),
                    mobile_gates,
                );
            } else {
                self.error_under(
                    module,
                    &gates,
                    "unsupported mobile entry point target; reviewed run function required".into(),
                );
            }
        }
    }
}

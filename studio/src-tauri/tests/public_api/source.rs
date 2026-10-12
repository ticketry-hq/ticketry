use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};
use syn::ext::IdentExt;

use syn::{Attribute, Item, Visibility};

#[path = "source_imports.rs"]
mod source_imports;
use source_imports::flatten_use;
#[path = "macro_provenance.rs"]
mod macro_provenance;
#[path = "reviewed_local_macros.rs"]
mod reviewed_local_macros;
#[path = "source_bodies.rs"]
mod source_bodies;
#[path = "source_expansions.rs"]
mod source_expansions;
#[path = "source_foreign.rs"]
mod source_foreign;
#[path = "source_item_macros.rs"]
mod source_item_macros;
#[path = "source_locations.rs"]
mod source_locations;

use super::attributes;
use super::model::{Binding, BindingKind, Crate, CrateInput, Module, Program};

pub fn load_crates(inputs: &[CrateInput]) -> Program {
    let mut loader = Loader {
        program: Program::default(),
        active: Vec::new(),
    };
    for input in inputs {
        let path = fs::canonicalize(&input.root).unwrap_or_else(|_| input.root.clone());
        let root = loader.module(&input.name, None, path.clone(), Vec::new());
        loader.program.crates.insert(
            input.name.clone(),
            Crate {
                root,
                dependencies: input.dependencies.clone(),
            },
        );
        loader.file(root, &path, path.parent().unwrap_or(Path::new(".")), &[]);
    }
    macro_provenance::validate(&mut loader.program);
    loader.program
}

struct Loader {
    program: Program,
    active: Vec<PathBuf>,
}

impl Loader {
    fn module(
        &mut self,
        crate_name: &str,
        parent: Option<usize>,
        source: PathBuf,
        logical_path: Vec<String>,
    ) -> usize {
        let id = self.program.modules.len();
        self.program.modules.push(Module {
            crate_name: crate_name.into(),
            parent,
            symbols: BTreeMap::new(),
            source,
            logical_path,
            expansions: Vec::new(),
            macro_references: Vec::new(),
            glob_imports: Vec::new(),
            opaque_macro_scope: false,
            reviewed_local_macros: Vec::new(),
            body_bindings: Vec::new(),
            opaque_body_imports: false,
        });
        id
    }

    fn file(&mut self, module: usize, path: &Path, directory: &Path, gates: &[String]) {
        let canonical = fs::canonicalize(path).unwrap_or_else(|_| path.to_owned());
        if self.active.contains(&canonical) {
            self.error_under(
                module,
                gates,
                format!("source module cycle through {}", path.display()),
            );
            return;
        }
        let source = match fs::read_to_string(path) {
            Ok(source) => source,
            Err(error) => {
                self.error_under(
                    module,
                    gates,
                    format!("cannot load module {}: {error}", path.display()),
                );
                return;
            }
        };
        let syntax = match syn::parse_file(&source) {
            Ok(syntax) => syntax,
            Err(error) => {
                self.error_under(
                    module,
                    gates,
                    format!("cannot parse module {}: {error}", path.display()),
                );
                return;
            }
        };
        self.active.push(canonical);
        let previous_source =
            std::mem::replace(&mut self.program.modules[module].source, path.to_owned());
        let file_evidence = attributes::inspect(&syntax.attrs);
        self.program.modules[module].opaque_macro_scope |= file_evidence.macro_use;
        let mut gates = gates.to_vec();
        gates.extend(file_evidence.gates);
        for error in file_evidence.errors {
            self.error_under(module, &gates, error);
        }
        self.items(module, &syntax.items, directory, &gates);
        self.active.pop();
        self.program.modules[module].source = previous_source;
    }

    fn items(&mut self, module: usize, items: &[Item], directory: &Path, inherited: &[String]) {
        for item in items {
            let evidence = attributes::inspect(item_attributes(item));
            self.program.modules[module].opaque_macro_scope |= evidence.macro_use;
            let mut gates = inherited.to_vec();
            gates.extend(evidence.gates.clone());
            gates.sort();
            gates.dedup();
            // Every declaration kind can carry export-bearing constant
            // expressions (bodies, discriminants, array lengths, const generic
            // defaults). Modules, imports and item macros have dedicated walks.
            if !matches!(
                item,
                Item::Mod(_) | Item::Use(_) | Item::ExternCrate(_) | Item::Macro(_)
            ) {
                let body = source_bodies::inspect(item);
                self.program.modules[module]
                    .body_bindings
                    .extend(body.bindings);
                self.program.modules[module].opaque_body_imports |= body.opaque_imports;
                self.program.modules[module]
                    .macro_references
                    .extend(body.macros.into_iter().map(|mut path| {
                        path.insert(0, "__body".into());
                        (path, gates.clone())
                    }));
                self.program.modules[module].macro_references.extend(
                    body.attributes.into_iter().map(|mut path| {
                        path.insert(0, "__nested".into());
                        (path, gates.clone())
                    }),
                );
                for error in body.errors {
                    self.error_under(module, &gates, error);
                }
            }
            for helper in &evidence.helpers {
                let paired =
                    evidence
                        .macro_references
                        .iter()
                        .any(|(path, _)| match helper.as_str() {
                            "serde" => path.last().is_some_and(|name| {
                                matches!(name.as_str(), "Serialize" | "Deserialize")
                            }),
                            "seaography" => path.last().is_some_and(|name| {
                                matches!(name.as_str(), "CustomInputType" | "CustomOutputType")
                            }),
                            "sea_orm" => {
                                path.last().is_some_and(|name| name == "DeriveEntityModel")
                            }
                            _ => false,
                        });
                if !paired {
                    self.error_under(module, &gates, format!("unsupported helper attribute `{helper}` without a canonical supported derive; add explicit handling and compile evidence"));
                }
            }
            self.program.modules[module].macro_references.extend(
                evidence.macro_references.iter().map(|(path, conditions)| {
                    let mut conditions = conditions.clone();
                    conditions.extend(gates.clone());
                    (path.clone(), conditions)
                }),
            );
            for error in &evidence.errors {
                self.error_under(module, &gates, error.clone());
            }
            self.expansion_roots(module, item, &evidence, &gates);
            let leaf = match item {
                Item::Const(item) => Some((&item.ident, &item.vis, "const")),
                Item::Enum(item) => Some((&item.ident, &item.vis, "enum")),
                Item::Fn(item) => Some((&item.sig.ident, &item.vis, "fn")),
                Item::Static(item) => Some((&item.ident, &item.vis, "static")),
                Item::Struct(item) => Some((&item.ident, &item.vis, "struct")),
                Item::Trait(item) => Some((&item.ident, &item.vis, "trait")),
                Item::TraitAlias(item) => Some((&item.ident, &item.vis, "trait_alias")),
                Item::Type(item) => Some((&item.ident, &item.vis, "type")),
                Item::Union(item) => Some((&item.ident, &item.vis, "union")),
                _ => None,
            };
            if let Some((name, visibility, kind)) = leaf {
                self.bind(
                    module,
                    name.unraw().to_string(),
                    public(visibility),
                    BindingKind::Leaf(kind.into()),
                    gates.clone(),
                );
                if !evidence.generated.is_empty() {
                    if name.unraw() != "Model"
                        || kind != "struct"
                        || !evidence
                            .expansions
                            .iter()
                            .any(|name| name == "SeaORM DeriveEntityModel")
                    {
                        self.error_under(module, &gates, "unsupported SeaORM expansion target; only a Model struct with DeriveEntityModel has explicit generated handling and compile evidence".into());
                    } else {
                        self.program.modules[module]
                            .expansions
                            .extend(evidence.expansions);
                        for (name, kind, conditions) in evidence.generated {
                            let mut generated_gates = inherited.to_vec();
                            generated_gates.extend(evidence.gates.clone());
                            generated_gates.extend(conditions);
                            self.bind(
                                module,
                                name,
                                public(visibility),
                                BindingKind::Leaf(kind),
                                generated_gates,
                            );
                        }
                    }
                }
                continue;
            }
            if !evidence.generated.is_empty() {
                self.error_under(module, &gates, "unsupported SeaORM expansion target; generated handling requires a Model struct and compile evidence".into());
            }
            match item {
                Item::Mod(item) => self.child(module, item, directory, gates, evidence),
                Item::Use(item) => {
                    let mut imports = Vec::new();
                    flatten_use(&item.tree, &[], &mut imports);
                    for (name, path, glob) in imports {
                        if glob { self.program.modules[module].glob_imports.push(path.clone()); }
                        let kind = if glob { BindingKind::Glob } else {
                            BindingKind::Use { path, absolute: item.leading_colon.is_some() }
                        };
                        self.bind(module, name, public(&item.vis), kind, gates.clone());
                    }
                }
                Item::ExternCrate(item) => {
                    let original = item.ident.unraw().to_string();
                    let target = if original == "self" {
                        self.program.modules[module].crate_name.clone()
                    } else { self.program.crates.get(&self.program.modules[module].crate_name)
                        .and_then(|krate| krate.dependencies.get(&original)).cloned()
                        .unwrap_or(original) };
                    let name = item.rename.as_ref().map(|(_, alias)| alias.unraw().to_string())
                        .unwrap_or_else(|| item.ident.unraw().to_string());
                    self.bind(module, name, public(&item.vis), BindingKind::Crate(target), gates);
                }
                Item::ForeignMod(item) => self.foreign(module, &item.items, &gates),
                Item::Macro(item) if item.ident.is_some() => {
                    match reviewed_local_macros::handler_wrapper(item) {
                        Ok(true) => {
                            self.program.modules[module].reviewed_local_macros.push(item.ident.as_ref().unwrap().unraw().to_string());
                            self.program.modules[module].macro_references.push((vec!["__body".into(), "tauri".into(), "generate_handler".into()], gates.clone()));
                        },
                        Ok(false) => {},
                        Err(error) => self.error_under(module, &gates, error),
                    }
                    self.bind(module, item.ident.as_ref().unwrap().unraw().to_string(), false,
                        BindingKind::Leaf("macro".into()), gates.clone());
                    if evidence.macro_export {
                        let root = self.program.crates[&self.program.modules[module].crate_name].root;
                        self.bind(root, item.ident.as_ref().unwrap().unraw().to_string(), true,
                                  BindingKind::Leaf("macro".into()), gates);
                    }
                }
                Item::Macro(item) if item.mac.path.is_ident("include") || item.mac.path.segments.iter().map(|part| part.ident.to_string()).collect::<Vec<_>>() == ["std", "include"] => {
                    match syn::parse2::<syn::LitStr>(item.mac.tokens.clone()) {
                        Ok(literal) => {
                            let include = self.program.modules[module].source.parent().unwrap().join(literal.value());
                            let mut path = vec!["__item".into()];
                            path.extend(item.mac.path.segments.iter().map(|part| part.ident.unraw().to_string()));
                            self.program.modules[module].macro_references.push((path, gates.clone()));
                            self.file(module, &include, include.parent().unwrap(), &gates);
                        }
                        Err(error) => self.error_under(module, &gates, format!("unsupported include expansion: literal source path required: {error}; compiler evidence required")),
                    }
                }
                Item::Macro(item) => match source_item_macros::expand(&item.mac) {
                    Ok(Some(items)) => {
                        let mut path = vec!["__body".into()];
                        path.extend(item.mac.path.segments.iter().map(|part| part.ident.unraw().to_string()));
                        self.program.modules[module].macro_references.push((path, gates.clone()));
                        self.items(module, &items, directory, &gates);
                    }
                    Ok(None) => self.error_under(module, &gates, format!("unsupported item macro `{}`: export expansion needs explicit supported handling and compile evidence", item.mac.path.segments.iter().map(|part| part.ident.unraw().to_string()).collect::<Vec<_>>().join("::"))),
                    Err(error) => self.error_under(module, &gates, error),
                },
                Item::Verbatim(_) => self.error_under(module, &gates, "unsupported source item; cannot establish public exposure".into()),
                _ => {}
            }
        }
    }

    fn bind(
        &mut self,
        module: usize,
        name: String,
        public: bool,
        kind: BindingKind,
        gates: Vec<String>,
    ) {
        let source = self.program.modules[module].source.display().to_string();
        self.program.modules[module]
            .symbols
            .entry(name)
            .or_default()
            .push(Binding {
                public,
                kind,
                gates,
                source,
            });
    }

    fn error(&mut self, module: usize, message: String) {
        let item = &self.program.modules[module];
        self.program.diagnostics.push(format!(
            "{} [{}::{}]: {message}",
            item.source.display(),
            item.crate_name,
            item.logical_path.join("::")
        ));
    }

    fn error_under(&mut self, module: usize, gates: &[String], message: String) {
        self.error(
            module,
            if gates.is_empty() {
                message
            } else {
                format!("{message}; gating evidence: {}", gates.join(" && "))
            },
        );
    }
}

fn public(visibility: &Visibility) -> bool {
    matches!(visibility, Visibility::Public(_))
}

fn item_attributes(item: &Item) -> &[Attribute] {
    match item {
        Item::Const(item) => &item.attrs,
        Item::Enum(item) => &item.attrs,
        Item::ExternCrate(item) => &item.attrs,
        Item::Fn(item) => &item.attrs,
        Item::Impl(item) => &item.attrs,
        Item::Macro(item) => &item.attrs,
        Item::Mod(item) => &item.attrs,
        Item::Static(item) => &item.attrs,
        Item::Struct(item) => &item.attrs,
        Item::Trait(item) => &item.attrs,
        Item::TraitAlias(item) => &item.attrs,
        Item::Type(item) => &item.attrs,
        Item::Union(item) => &item.attrs,
        Item::Use(item) => &item.attrs,
        Item::ForeignMod(item) => &item.attrs,
        _ => &[],
    }
}

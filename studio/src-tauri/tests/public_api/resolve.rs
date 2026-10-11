use std::collections::BTreeSet;

use super::model::{BindingKind, Program};

#[derive(Clone, Debug, PartialEq, Eq, PartialOrd, Ord)]
pub enum Target {
    Leaf {
        module: usize,
        name: String,
        kind: String,
    },
    Module(usize),
    Crate(String),
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Resolved {
    pub target: Target,
    pub gates: Vec<String>,
    pub chain: Vec<String>,
}

pub struct Resolver<'a> {
    program: &'a Program,
}

#[derive(Clone, Default)]
struct Trace {
    active: BTreeSet<(usize, String, bool)>,
    gates: Vec<String>,
    chain: Vec<String>,
}

impl<'a> Resolver<'a> {
    pub fn new(program: &'a Program) -> Self {
        Self { program }
    }

    pub fn resolve(&self, module: usize, name: &str) -> Result<Vec<Resolved>, Vec<String>> {
        self.symbol(module, name, true, false, &Trace::default())
    }

    pub(super) fn inspect_path(
        &self,
        module: usize,
        path: &[String],
    ) -> Result<Vec<Resolved>, Vec<String>> {
        self.path(module, path, false, &Trace::default())
    }

    fn symbol(
        &self,
        module: usize,
        name: &str,
        public_only: bool,
        namespace_only: bool,
        trace: &Trace,
    ) -> Result<Vec<Resolved>, Vec<String>> {
        let mut trace = trace.clone();
        let label = self.label(module, name);
        trace.chain.push(label);
        if !trace.active.insert((module, name.into(), namespace_only)) {
            return Err(self.error("public target resolution cycle", &trace));
        }
        let bindings = self.program.modules[module]
            .symbols
            .get(name)
            .ok_or_else(|| self.error("unresolved public target", &trace))?;
        if public_only && !bindings.iter().any(|binding| binding.public) {
            return Err(self.error("target is not public across crate boundary", &trace));
        }
        let mut resolved = Vec::new();
        let mut errors = Vec::new();
        let has_namespace = bindings
            .iter()
            .any(|binding| matches!(binding.kind, BindingKind::Module(_) | BindingKind::Crate(_)));
        let has_public_item = bindings.iter().any(|binding| {
            binding.public
                && !matches!(binding.kind, BindingKind::Module(_) | BindingKind::Crate(_))
        });
        for binding in bindings {
            if namespace_only
                && has_namespace
                && !matches!(binding.kind, BindingKind::Module(_) | BindingKind::Crate(_))
            {
                continue;
            }
            if !namespace_only && has_public_item && !binding.public {
                continue;
            }
            if public_only && !binding.public {
                continue;
            }
            let mut trace = trace.clone();
            trace.gates.extend(binding.gates.clone());
            trace.gates.sort();
            trace.gates.dedup();
            trace.chain.push(binding.source.clone());
            let targets = match &binding.kind {
                BindingKind::Leaf(_) if !binding.public => {
                    Err(self.error("private leaf cannot be publicly re-exported", &trace))
                }
                BindingKind::Leaf(kind) => Ok(vec![Self::value(
                    Target::Leaf {
                        module,
                        name: name.into(),
                        kind: kind.clone(),
                    },
                    &trace,
                )]),
                BindingKind::Module(module) => {
                    Ok(vec![Self::value(Target::Module(*module), &trace)])
                }
                BindingKind::Use { path, absolute } => self.path(module, path, *absolute, &trace),
                BindingKind::Crate(crate_name) => self.dependency(crate_name, &trace),
                BindingKind::Glob => Err(self.error(
                    "public glob exports are forbidden; explicitly name each capability",
                    &trace,
                )),
            };
            match targets {
                Ok(targets) => {
                    if !binding.public
                        && matches!(binding.kind, BindingKind::Use { .. })
                        && targets
                            .iter()
                            .any(|value| matches!(value.target, Target::Leaf { .. }))
                    {
                        errors.extend(
                            self.error(
                                "private leaf import cannot be publicly re-exported",
                                &trace,
                            ),
                        );
                    } else {
                        resolved.extend(targets);
                    }
                }
                Err(diagnostics) => errors.extend(diagnostics),
            }
        }
        if errors.is_empty() {
            Ok(resolved)
        } else {
            Err(errors)
        }
    }

    fn path(
        &self,
        module: usize,
        path: &[String],
        absolute: bool,
        trace: &Trace,
    ) -> Result<Vec<Resolved>, Vec<String>> {
        let Some(first) = path.first() else {
            return Err(self.error("unsupported empty public target path", trace));
        };
        let crate_name = &self.program.modules[module].crate_name;
        let dependencies = &self.program.crates[crate_name].dependencies;
        let (values, consumed) = if absolute {
            let dependency = dependencies.get(first).ok_or_else(|| {
                self.error(&format!("unsupported absolute dependency {first}"), trace)
            })?;
            (self.dependency(dependency, trace)?, 1)
        } else {
            match first.as_str() {
                "crate" => (
                    vec![Self::value(Target::Crate(crate_name.clone()), trace)],
                    1,
                ),
                "self" => (vec![Self::value(Target::Module(module), trace)], 1),
                "super" => {
                    let mut parent = module;
                    let mut consumed = 0;
                    for segment in path
                        .iter()
                        .take_while(|segment| segment.as_str() == "super")
                    {
                        let _ = segment;
                        parent = self.program.modules[parent].parent.ok_or_else(|| {
                            self.error("super path escapes the crate root", trace)
                        })?;
                        consumed += 1;
                    }
                    (vec![Self::value(Target::Module(parent), trace)], consumed)
                }
                _ if self.program.modules[module].symbols.contains_key(first) => {
                    (self.symbol(module, first, false, path.len() > 1, trace)?, 1)
                }
                _ if dependencies.contains_key(first) => {
                    (self.dependency(&dependencies[first], trace)?, 1)
                }
                _ => (self.symbol(module, first, false, path.len() > 1, trace)?, 1),
            }
        };
        let mut values = values;
        for (index, segment) in path[consumed..].iter().enumerate() {
            let namespace_only = consumed + index + 1 < path.len();
            let mut next = Vec::new();
            for value in values {
                let mut next_trace = trace.clone();
                next_trace.gates = value.gates;
                next_trace.chain = value.chain;
                match value.target {
                    Target::Module(target_module) => {
                        let external =
                            self.program.modules[target_module].crate_name != *crate_name;
                        next.extend(self.symbol(
                            target_module,
                            segment,
                            external,
                            namespace_only,
                            &next_trace,
                        )?);
                    }
                    Target::Crate(crate_name) => {
                        let root = self.program.crates[&crate_name].root;
                        let external = crate_name != self.program.modules[module].crate_name;
                        next.extend(self.symbol(
                            root,
                            segment,
                            external,
                            namespace_only,
                            &next_trace,
                        )?);
                    }
                    _ => {
                        return Err(
                            self.error("unsupported associated public target path", &next_trace)
                        )
                    }
                }
            }
            values = next;
        }
        Ok(values)
    }

    fn dependency(&self, crate_name: &str, trace: &Trace) -> Result<Vec<Resolved>, Vec<String>> {
        if !self.program.crates.contains_key(crate_name) {
            return Err(self.error(&format!("unsupported non-workspace dependency {crate_name}; explicit source handling and compile evidence required"), trace));
        }
        Ok(vec![Self::value(Target::Crate(crate_name.into()), trace)])
    }

    fn value(target: Target, trace: &Trace) -> Resolved {
        Resolved {
            target,
            gates: trace.gates.clone(),
            chain: trace.chain.clone(),
        }
    }

    fn label(&self, module: usize, name: &str) -> String {
        let source = &self.program.modules[module];
        let mut path = vec![source.crate_name.clone()];
        path.extend(source.logical_path.clone());
        path.push(name.into());
        format!("{} at {}", path.join("::"), source.source.display())
    }

    fn error(&self, cause: &str, trace: &Trace) -> Vec<String> {
        vec![format!(
            "{cause}; resolution chain: {}; gating: {}",
            trace.chain.join(" -> "),
            if trace.gates.is_empty() {
                "unconditional".into()
            } else {
                trace.gates.join(" && ")
            }
        )]
    }
}

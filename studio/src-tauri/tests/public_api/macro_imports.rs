//! Imported and glob macro provenance uses actual workspace scopes.
use super::{canonical_glob, canonical_path, BindingKind, Program};
pub(super) fn safe_glob(program: &Program, module: usize, path: &[String], name: &str) -> bool {
    if [
        "sea-orm",
        "serde",
        "sea-orm-migration",
        "seaography",
        "async-graphql",
        "schemars",
    ]
    .iter()
    .any(|package| canonical_glob(program, module, path, package))
    {
        return true;
    }
    let Ok(targets) = crate::resolve::Resolver::new(program).inspect_path(module, path) else {
        return false;
    };
    targets.into_iter().all(|target| {
        let target = match target.target {
            crate::resolve::Target::Module(module) => module,
            crate::resolve::Target::Crate(ref krate) => program.crates[krate].root,
            _ => return false,
        };
        glob_namespace_safe(
            program,
            target,
            name,
            &mut std::collections::BTreeSet::new(),
        )
    })
}

pub(super) fn glob_namespace_safe(
    program: &Program,
    module: usize,
    name: &str,
    visited: &mut std::collections::BTreeSet<usize>,
) -> bool {
    if !visited.insert(module) {
        return false;
    }
    let source = &program.modules[module];
    if source.opaque_macro_scope {
        return false;
    }
    if let Some(bindings) = source.symbols.get(name) {
        if bindings.iter().any(|binding| match &binding.kind {
            BindingKind::Leaf(kind) => kind == "macro",
            BindingKind::Use { .. } => true,
            _ => false,
        }) {
            return false;
        }
    }
    let result = source.glob_imports.iter().all(|path| {
        if [
            "sea-orm",
            "serde",
            "sea-orm-migration",
            "seaography",
            "async-graphql",
            "schemars",
        ]
        .iter()
        .any(|package| canonical_glob(program, module, path, package))
        {
            return true;
        }
        let Ok(targets) = crate::resolve::Resolver::new(program).inspect_path(module, path) else {
            return false;
        };
        targets.into_iter().all(|target| match target.target {
            crate::resolve::Target::Module(target) => {
                glob_namespace_safe(program, target, name, visited)
            }
            crate::resolve::Target::Crate(krate) => {
                glob_namespace_safe(program, program.crates[&krate].root, name, visited)
            }
            _ => false,
        })
    });
    visited.remove(&module);
    result
}

pub(super) fn imported_macro(
    program: &Program,
    module: usize,
    name: &str,
    package: &str,
    visited: &mut std::collections::BTreeSet<(usize, String)>,
) -> bool {
    if !visited.insert((module, name.into())) {
        return false;
    }
    let source = &program.modules[module];
    if let Some(bindings) = source.symbols.get(name) {
        return bindings.iter().all(|binding| match &binding.kind {
            BindingKind::Use { path, .. } => {
                macro_import_path(program, module, path, package, &mut visited.clone())
            }
            _ => false,
        });
    }
    let mut origin = false;
    for path in &source.glob_imports {
        if canonical_glob(program, module, path, package) {
            origin = true;
            continue;
        }
        let Ok(targets) = crate::resolve::Resolver::new(program).inspect_path(module, path) else {
            return false;
        };
        for target in targets {
            let target = match target.target {
                crate::resolve::Target::Module(target) => target,
                crate::resolve::Target::Crate(krate) => program.crates[&krate].root,
                _ => return false,
            };
            if imported_macro(program, target, name, package, &mut visited.clone()) {
                origin = true;
            } else if !glob_namespace_safe(
                program,
                target,
                name,
                &mut std::collections::BTreeSet::new(),
            ) {
                return false;
            }
        }
    }
    origin
}

pub(super) fn macro_import_path(
    program: &Program,
    module: usize,
    path: &[String],
    package: &str,
    visited: &mut std::collections::BTreeSet<(usize, String)>,
) -> bool {
    if canonical_path(program, module, path, package) {
        return true;
    }
    let Some((name, prefix)) = path.split_last() else {
        return false;
    };
    if prefix.is_empty() {
        return imported_macro(program, module, name, package, visited);
    }
    let Ok(targets) = crate::resolve::Resolver::new(program).inspect_path(module, prefix) else {
        return false;
    };
    targets.into_iter().all(|target| match target.target {
        crate::resolve::Target::Module(target) => {
            imported_macro(program, target, name, package, visited)
        }
        crate::resolve::Target::Crate(krate) => {
            imported_macro(program, program.crates[&krate].root, name, package, visited)
        }
        _ => false,
    })
}

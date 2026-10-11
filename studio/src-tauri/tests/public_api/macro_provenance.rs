use super::super::model::{BindingKind, Program};
#[path = "macro_imports.rs"]
mod macro_imports;
use macro_imports::{imported_macro, macro_import_path, safe_glob};

const BUILTINS: &[&str] = &[
    "Clone",
    "Copy",
    "Debug",
    "Default",
    "PartialEq",
    "Eq",
    "PartialOrd",
    "Ord",
    "Hash",
];

pub(super) fn validate(program: &mut Program) {
    let mut diagnostics = Vec::new();
    for (module, source) in program.modules.iter().enumerate() {
        for (path, gates) in &source.macro_references {
            if !supported(program, module, path) {
                diagnostics.push(format!(
                    "{} [{}::{}]: unsupported macro provenance for `{}`; a local/import shadow or unknown glob prevents canonical expansion proof; add explicit handling and compile evidence; gating evidence: {}",
                    source.source.display(), source.crate_name, source.logical_path.join("::"),
                    path.join("::"), if gates.is_empty() { "unconditional".into() } else { gates.join(" && ") }
                ));
            }
        }
    }
    program.diagnostics.extend(diagnostics);
}

fn supported(program: &Program, module: usize, path: &[String]) -> bool {
    let mut scope = Some(module);
    while let Some(current) = scope {
        if program.modules[current].opaque_macro_scope {
            return false;
        }
        scope = program.modules[current].parent;
    }
    if path.first().is_some_and(|part| part == "__item")
        && path.last().is_some_and(|part| part == "include")
    {
        return !shadowed(program, module, "include")
            && (path.len() == 2
                || (path
                    == &[
                        "__item".to_string(),
                        "std".to_string(),
                        "include".to_string(),
                    ]
                    && !shadowed(program, module, "std")))
            && program.modules[module]
                .glob_imports
                .iter()
                .all(|path| safe_glob(program, module, path, "include"));
    }
    if path.first().is_some_and(|part| part == "__nested") {
        let inner = &path[1..];
        let source = &program.modules[module];
        return !source.opaque_body_imports
            && !source
                .body_bindings
                .iter()
                .any(|binding| inner.first() == Some(binding) || inner.last() == Some(binding))
            && supported(program, module, inner);
    }
    let Some(name) = path.last() else {
        return false;
    };
    if path.first().is_some_and(|part| part == "__body") {
        return body_macro(program, module, &path[1..]);
    }
    if name == "__helper" && path.len() == 2 {
        let package = match path[0].as_str() {
            "serde" => "serde",
            "sea_orm" => "sea-orm",
            "seaography" => "seaography",
            _ => return false,
        };
        return canonical_dependency(program, module, &path[0], package);
    }
    if path.len() == 1 && BUILTINS.contains(&name.as_str()) {
        return !shadowed(program, module, name)
            && program.modules[module]
                .glob_imports
                .iter()
                .all(|path| safe_glob(program, module, path, name));
    }
    if matches!(path, [prefix, scope, name] if (prefix == "core" || prefix == "std") && scope == "clone" && name == "Clone")
    {
        return !shadowed(program, module, &path[0]);
    }
    let package = match name.as_str() {
        "DeriveEntityModel" | "model" | "FromQueryResult" => "sea-orm",
        "DeriveMigrationName" | "DeriveIden" => "sea-orm-migration",
        "CustomFields" | "CustomInputType" | "CustomOutputType" => "seaography",
        "Object" => "async-graphql",
        "JsonSchema" => "schemars",
        "async_trait" if path.first().is_some_and(|part| part == "sea_orm") => "sea-orm",
        "async_trait" => "async-trait",
        "test" => "tokio",
        "command" | "mobile_entry_point" => "tauri",
        "procedures" | "resolvers" => "taurpc",
        "Serialize" | "Deserialize" => "serde",
        _ => return false,
    };
    if path.len() > 1 {
        return macro_import_path(
            program,
            module,
            path,
            package,
            &mut std::collections::BTreeSet::new(),
        );
    }
    imported_macro(
        program,
        module,
        name,
        package,
        &mut std::collections::BTreeSet::new(),
    )
}

fn body_macro(program: &Program, module: usize, path: &[String]) -> bool {
    const STANDARD: &[&str] = &[
        "println",
        "print",
        "eprintln",
        "eprint",
        "dbg",
        "vec",
        "format",
        "format_args",
        "write",
        "writeln",
        "assert",
        "assert_eq",
        "assert_ne",
        "debug_assert",
        "debug_assert_eq",
        "debug_assert_ne",
        "panic",
        "todo",
        "unimplemented",
        "unreachable",
        "matches",
        "concat",
        "stringify",
        "line",
        "column",
        "file",
        "module_path",
        "include_bytes",
        "include_str",
        "option_env",
        "env",
        "cfg",
        "thread_local",
    ];
    let Some(name) = path.last() else {
        return false;
    };
    let source = &program.modules[module];
    if source.opaque_body_imports
        || source
            .body_bindings
            .iter()
            .any(|binding| path.first() == Some(binding))
    {
        return false;
    }
    if !STANDARD.contains(&name.as_str()) {
        if name == "native_invoke_handler"
            && path.len() == 1
            && program.modules[module]
                .reviewed_local_macros
                .iter()
                .any(|known| known == name)
        {
            return true;
        }
        let package = match name.as_str() {
            "json" => "serde_json",
            "select" | "pin" | "task_local" => "tokio",
            "register_entity" | "register_entity_modules" => "seaography",
            "schema_for" => "schemars",
            "generate_context" | "generate_handler" => "tauri",
            _ => return false,
        };
        if path.len() > 1 {
            return canonical_path(program, module, path, package);
        }
        return imported_macro(
            program,
            module,
            name,
            package,
            &mut std::collections::BTreeSet::new(),
        );
    }
    let source = &program.modules[module];
    if source.opaque_body_imports
        || source
            .body_bindings
            .iter()
            .any(|name| path.first() == Some(name))
    {
        return false;
    }
    if path.len() == 1 {
        return !shadowed(program, module, name)
            && source
                .glob_imports
                .iter()
                .all(|path| safe_glob(program, module, path, name));
    }
    path.len() == 2
        && ["std", "core", "alloc"].contains(&path[0].as_str())
        && !shadowed(program, module, &path[0])
        && !program.crates[&source.crate_name]
            .dependencies
            .contains_key(&path[0])
}

fn canonical_path(program: &Program, module: usize, path: &[String], package: &str) -> bool {
    let Some(first) = path.first() else {
        return false;
    };
    if package == "async-trait"
        && path == &["async_trait".to_string(), "async_trait".to_string()]
        && !shadowed(program, module, "async_trait")
        && program.modules[module]
            .glob_imports
            .iter()
            .any(|path| canonical_glob(program, module, path, "sea-orm"))
    {
        return true;
    }
    if package == "async-graphql"
        && path.len() == 3
        && path[1] == "async_graphql"
        && path[2] == "Object"
        && canonical_dependency(program, module, first, "seaography")
    {
        return true;
    }
    if !canonical_dependency(program, module, first, package) {
        return false;
    }
    let suffix = path[1..].iter().map(String::as_str).collect::<Vec<_>>();
    match package {
        "serde" => matches!(suffix.as_slice(), ["Serialize" | "Deserialize"]),
        "sea-orm" => matches!(
            suffix.as_slice(),
            ["DeriveEntityModel" | "model" | "FromQueryResult"]
                | ["entity", "prelude", "DeriveEntityModel"]
                | ["prelude", "async_trait", "async_trait"]
        ),
        "sea-orm-migration" => matches!(
            suffix.as_slice(),
            ["DeriveMigrationName" | "DeriveIden"]
                | ["prelude", "DeriveMigrationName" | "DeriveIden"]
        ),
        "seaography" => matches!(
            suffix.as_slice(),
            ["CustomFields"
                | "CustomInputType"
                | "CustomOutputType"
                | "register_entity"
                | "register_entity_modules"]
        ),
        "async-trait" => matches!(suffix.as_slice(), ["async_trait"]),
        "async-graphql" => matches!(suffix.as_slice(), ["Object"]),
        "schemars" => matches!(suffix.as_slice(), ["JsonSchema" | "schema_for"]),
        "serde_json" => matches!(suffix.as_slice(), ["json"]),
        "tokio" => matches!(
            suffix.as_slice(),
            ["test" | "select" | "pin" | "task_local"]
        ),
        "tauri" => matches!(
            suffix.as_slice(),
            ["command" | "mobile_entry_point" | "generate_handler" | "generate_context"]
        ),
        "taurpc" => matches!(suffix.as_slice(), ["procedures" | "resolvers"]),
        _ => false,
    }
}

fn canonical_glob(program: &Program, module: usize, path: &[String], package: &str) -> bool {
    let Some(first) = path.first() else {
        return false;
    };
    canonical_dependency(program, module, first, package)
        && match package {
            "sea-orm" => {
                matches!(&path[1..], [entity, prelude] if entity == "entity" && prelude == "prelude")
            }
            "serde" => path.len() == 1,
            "sea-orm-migration" => matches!(&path[1..], [prelude] if prelude == "prelude"),
            "seaography" | "async-graphql" | "schemars" => path.len() == 1,
            _ => false,
        }
}

fn canonical_dependency(program: &Program, module: usize, alias: &str, package: &str) -> bool {
    if program.crates.contains_key(package) {
        return false;
    }
    let source = &program.modules[module];
    let dependencies = &program.crates[&source.crate_name].dependencies;
    if dependencies
        .get(alias)
        .is_none_or(|target| target != package)
    {
        return false;
    }
    let mut scope = Some(module);
    while let Some(current) = scope {
        if let Some(bindings) = program.modules[current].symbols.get(alias) {
            if !bindings.iter().all(
                |binding| matches!(&binding.kind, BindingKind::Crate(target) if target == package)
                    || matches!(&binding.kind, BindingKind::Use { path, .. } if package == "async-trait" && path == &[alias.to_string(), "async_trait".into()]),
            ) {
                return false;
            }
        }
        scope = program.modules[current].parent;
    }
    true
}

fn shadowed(program: &Program, module: usize, name: &str) -> bool {
    let mut scope = Some(module);
    while let Some(current) = scope {
        if program.modules[current].symbols.contains_key(name) {
            return true;
        }
        scope = program.modules[current].parent;
    }
    false
}

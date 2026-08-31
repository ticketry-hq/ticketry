use std::{
    collections::HashMap,
    fs,
    path::{Path, PathBuf},
};

use syn::{visit::Visit, Expr, ExprCall, File, UseTree};

const REGISTRARS: [(&str, usize); 7] = [
    ("register_generated_mutations", 3),
    ("register_hooked_create_one", 2),
    ("register_hooked_update", 2),
    ("register_hooked_delete", 2),
    ("register_restricted_model_mutation", 4),
    ("register_restricted_model_set_mutation", 4),
    ("register_action", 4),
];

#[derive(Debug, Eq, PartialEq)]
struct Violation {
    registrar: String,
    reason: String,
}

struct RegistrarCalls<'a> {
    path: &'a Path,
    imported: HashMap<String, (&'static str, usize)>,
    violations: Vec<Violation>,
}

impl RegistrarCalls<'_> {
    fn inspect_call(&mut self, call: &ExprCall) {
        let Expr::Path(function) = call.func.as_ref() else {
            return;
        };
        let segments = function
            .path
            .segments
            .iter()
            .map(|segment| segment.ident.to_string())
            .collect::<Vec<_>>();
        let Some(called_name) = segments.last() else {
            return;
        };
        let registration = if segments.first().is_some_and(|root| root == "seaolim") {
            registrar(called_name)
        } else if segments.len() == 1 {
            self.imported.get(called_name).copied()
        } else {
            None
        };
        let Some((registrar, expected_arguments)) = registration else {
            return;
        };

        if !is_nested_view_module(self.path) {
            self.violations.push(Violation {
                registrar: registrar.to_owned(),
                reason: "registration must live in views/<field>/mod.rs".to_owned(),
            });
        }
        if call.args.len() != expected_arguments {
            self.violations.push(Violation {
                registrar: registrar.to_owned(),
                reason: format!(
                    "expected {expected_arguments} arguments, including the view-owned serializer table, found {}",
                    call.args.len()
                ),
            });
        }
    }
}

impl<'ast> Visit<'ast> for RegistrarCalls<'_> {
    fn visit_expr_call(&mut self, call: &'ast ExprCall) {
        self.inspect_call(call);
        syn::visit::visit_expr_call(self, call);
    }
}

fn registrar(name: &str) -> Option<(&'static str, usize)> {
    REGISTRARS
        .iter()
        .copied()
        .find(|(registrar, _)| *registrar == name)
}

fn seaolim_imports(file: &File) -> HashMap<String, (&'static str, usize)> {
    let mut imports = HashMap::new();
    for item in &file.items {
        let syn::Item::Use(item_use) = item else {
            continue;
        };
        collect_imports(&item_use.tree, false, &mut imports);
    }
    imports
}

fn collect_imports(
    tree: &UseTree,
    inside_seaolim: bool,
    imports: &mut HashMap<String, (&'static str, usize)>,
) {
    match tree {
        UseTree::Path(path) => collect_imports(
            &path.tree,
            inside_seaolim || path.ident == "seaolim",
            imports,
        ),
        UseTree::Name(name) if inside_seaolim => {
            let imported = name.ident.to_string();
            if let Some(registration) = registrar(&imported) {
                imports.insert(imported, registration);
            }
        }
        UseTree::Rename(rename) if inside_seaolim => {
            if let Some(registration) = registrar(&rename.ident.to_string()) {
                imports.insert(rename.rename.to_string(), registration);
            }
        }
        UseTree::Glob(_) if inside_seaolim => {
            for (name, expected_arguments) in REGISTRARS {
                imports.insert(name.to_owned(), (name, expected_arguments));
            }
        }
        UseTree::Group(group) => {
            for item in &group.items {
                collect_imports(item, inside_seaolim, imports);
            }
        }
        _ => {}
    }
}

fn is_nested_view_module(path: &Path) -> bool {
    if path.file_name().and_then(|name| name.to_str()) != Some("mod.rs") {
        return false;
    }
    let components = path
        .components()
        .filter_map(|component| component.as_os_str().to_str())
        .collect::<Vec<_>>();
    components
        .windows(2)
        .any(|pair| pair[0] == "views" && pair[1] != "mod.rs")
}

fn audit_source(path: &Path, source: &str) -> Vec<Violation> {
    let file = syn::parse_file(source)
        .unwrap_or_else(|error| panic!("parse {} for GraphQL view audit: {error}", path.display()));
    let imported = seaolim_imports(&file);
    let mut violations = Vec::new();
    for item in &file.items {
        let syn::Item::Use(item_use) = item else {
            continue;
        };
        if matches!(item_use.vis, syn::Visibility::Inherited) {
            continue;
        }
        let mut reexports = HashMap::new();
        collect_imports(&item_use.tree, false, &mut reexports);
        for (name, (registrar, _)) in reexports {
            violations.push(Violation {
                registrar: registrar.to_owned(),
                reason: format!(
                    "Seaolim registrar must not be re-exported as {name}; call it in the owning view"
                ),
            });
        }
    }
    let mut calls = RegistrarCalls {
        path,
        imported,
        violations,
    };
    calls.visit_file(&file);
    calls.violations
}

fn rust_sources(directory: &Path, files: &mut Vec<PathBuf>) {
    for entry in fs::read_dir(directory)
        .unwrap_or_else(|error| panic!("read {}: {error}", directory.display()))
    {
        let path = entry.expect("read source entry").path();
        if path.is_dir() {
            rust_sources(&path, files);
        } else if path.extension().and_then(|extension| extension.to_str()) == Some("rs") {
            files.push(path);
        }
    }
}

/// Every directory the registration contract audits: the root package's `src`
/// plus each extracted slice crate's `src`. Slices keep their own Seaography
/// registrars, so the audit follows them out of the root crate rather than
/// silently shrinking as the workspace split proceeds.
fn audited_source_roots() -> Vec<PathBuf> {
    let manifest = Path::new(env!("CARGO_MANIFEST_DIR"));
    let mut roots = vec![manifest.join("src")];
    let crates = manifest.join("crates");
    let mut slices: Vec<PathBuf> = fs::read_dir(&crates)
        .unwrap_or_else(|error| panic!("read {}: {error}", crates.display()))
        .map(|entry| entry.expect("read crates entry").path().join("src"))
        .filter(|path| path.is_dir())
        .collect();
    slices.sort();
    roots.extend(slices);
    roots
}

#[test]
fn migrated_graphql_registrars_use_nested_view_owned_bindings() {
    let mut failures = Vec::new();
    for source_root in audited_source_roots() {
        let mut files = Vec::new();
        rust_sources(&source_root, &mut files);
        files.sort();

        for path in files {
            let source = fs::read_to_string(&path)
                .unwrap_or_else(|error| panic!("read {}: {error}", path.display()));
            for violation in audit_source(&path, &source) {
                let relative = path.strip_prefix(&source_root).unwrap_or(&path);
                failures.push(format!(
                    "{}: {}: {}",
                    relative.display(),
                    violation.registrar,
                    violation.reason
                ));
            }
        }
    }

    assert!(
        failures.is_empty(),
        "GraphQL view registration contract failed:\n{}",
        failures.join("\n")
    );
}

#[test]
fn superseded_seaolim_migration_files_stay_removed() {
    // Workspace-relative, because a superseded file's home moves with its
    // slice: a module extracted into `crates/` keeps its filenames but loses
    // the `src/<module>/` prefix it had in the root package.
    let workspace = Path::new(env!("CARGO_MANIFEST_DIR"));
    for relative in [
        "crates/ticketry-documents/src/save/graphql.rs",
        "crates/ticketry-runs/src/persistence/attempt_graphql.rs",
        "crates/ticketry-runs/src/persistence/lifecycle_graphql.rs",
        "crates/ticketry-work-management/src/work_management/commands/module_presentation.rs",
        "crates/ticketry-work-management/src/work_management/graphql/catalog.rs",
        "crates/ticketry-work-management/src/work_management/graphql/module_presentations.rs",
        "crates/ticketry-work-management/src/work_management/graphql/work_items.rs",
        "crates/ticketry-work-management/src/work_management/graphql/workflow_configuration.rs",
        "src/documents/save/graphql.rs",
        "src/graph_run_service/graphql.rs",
        "src/graph_run_service/operation_registry.rs",
        "src/run_now/graphql.rs",
        "src/run_now/launcher.rs",
        "src/run_now/mod.rs",
        "src/run_now/operation_registry.rs",
        "src/run_now/service.rs",
        "src/run_now/types.rs",
        "src/runs_persistence/attempt_graphql.rs",
        "src/runs_persistence/lifecycle_graphql.rs",
        "src/terminal/output_activity/graphql.rs",
        "src/terminal/output_activity/operation_registry.rs",
        "src/work_management/commands/module_presentation.rs",
        "src/work_management/graphql/catalog.rs",
        "src/work_management/graphql/module_presentations.rs",
        "src/work_management/graphql/work_items.rs",
        "src/work_management/graphql/workflow_configuration.rs",
        "src/worktree/create/graphql.rs",
        "src/worktree/discard/graphql.rs",
    ] {
        assert!(
            !workspace.join(relative).exists(),
            "superseded Seaolim migration file returned: {relative}"
        );
    }
}

#[test]
fn contract_detects_location_and_serializer_table_bypasses() {
    let outside_view = audit_source(
        Path::new("src/work_management/graphql.rs"),
        r#"
            fn register(builder: &mut Builder) {
                seaolim::register_action::<Entity, _>(builder, field(), action(), bindings());
            }
        "#,
    );
    assert_eq!(
        outside_view,
        [Violation {
            registrar: "register_action".to_owned(),
            reason: "registration must live in views/<field>/mod.rs".to_owned(),
        }]
    );

    let missing_bindings = audit_source(
        Path::new("src/work_management/project/views/update/mod.rs"),
        r#"
            use seaolim::register_restricted_model_mutation;

            fn register(builder: &mut Builder) {
                register_restricted_model_mutation::<Entity, ActiveModel, _>(
                    builder,
                    field(),
                    update_project(),
                );
            }
        "#,
    );
    assert_eq!(
        missing_bindings,
        [Violation {
            registrar: "register_restricted_model_mutation".to_owned(),
            reason: "expected 4 arguments, including the view-owned serializer table, found 3"
                .to_owned(),
        }]
    );

    let reexport = audit_source(
        Path::new("src/graphql_foundation/registrars.rs"),
        "pub use seaolim::register_action as register_mutation;",
    );
    assert_eq!(
        reexport,
        [Violation {
            registrar: "register_action".to_owned(),
            reason: "Seaolim registrar must not be re-exported as register_mutation; call it in the owning view"
                .to_owned(),
        }]
    );
}

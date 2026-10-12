#[path = "public_api/model.rs"]
mod model;
#[path = "public_api/source.rs"]
mod source;

use model::CrateInput;
use std::collections::BTreeMap;

#[test]
fn explicit_leaf_exports_load_from_private_file_and_inline_modules() {
    let directory = tempfile::tempdir().unwrap();
    std::fs::write(directory.path().join("lib.rs"), "mod file; mod inline { pub const LIMIT: usize = 3; } pub use file::{run, Input as Request}; pub use inline::LIMIT;").unwrap();
    std::fs::write(
        directory.path().join("file.rs"),
        "pub fn run() {} pub struct Input;",
    )
    .unwrap();
    let program = source::load_crates(&[CrateInput {
        name: "fixture".into(),
        root: directory.path().join("lib.rs"),
        dependencies: BTreeMap::new(),
    }]);
    assert!(program.diagnostics.is_empty(), "{:?}", program.diagnostics);
    let approvals = inventory::Approvals::parse(
        "fixture|LIMIT\nfixture|Request\nfixture|run\n",
        "fixture|LIMIT|const|\nfixture|Request|struct|\nfixture|run|fn|\n",
    )
    .unwrap();
    policy::audit(&program, &approvals, &[]).unwrap();
}

#[path = "public_api/resolve.rs"]
mod resolve;

#[test]
fn a_root_alias_resolves_to_an_explicit_leaf_capability() {
    let directory = tempfile::tempdir().unwrap();
    std::fs::write(
        directory.path().join("lib.rs"),
        "mod internals { pub fn run() {} } pub use internals::run as execute;",
    )
    .unwrap();
    let program = source::load_crates(&[CrateInput {
        name: "fixture".into(),
        root: directory.path().join("lib.rs"),
        dependencies: BTreeMap::new(),
    }]);
    assert!(program.diagnostics.is_empty(), "{:?}", program.diagnostics);
    let root = program.crates["fixture"].root;
    let resolved = resolve::Resolver::new(&program)
        .resolve(root, "execute")
        .unwrap();
    assert_eq!(resolved.len(), 1);
    assert!(
        matches!(&resolved[0].target, resolve::Target::Leaf { name, kind, .. } if name == "run" && kind == "fn")
    );
}

#[path = "public_api/attributes.rs"]
mod attributes;
#[path = "public_api/body_file_module_fixtures.rs"]
mod body_file_module_fixtures;
#[path = "public_api/body_macro_fixtures.rs"]
mod body_macro_fixtures;
#[path = "public_api/declaration_expression_fixtures.rs"]
mod declaration_expression_fixtures;
#[path = "public_api/compile_fixtures.rs"]
mod compile_fixtures;
#[path = "public_api/exception_records.rs"]
mod exception_records;
#[path = "public_api/exceptions.rs"]
mod exceptions;
#[path = "public_api/guard.rs"]
mod guard;
#[path = "public_api/guard_fixtures.rs"]
mod guard_fixtures;
#[path = "public_api/inventory.rs"]
mod inventory;
#[path = "public_api/inventory_fixtures.rs"]
mod inventory_fixtures;
#[path = "public_api/macro_provenance_fixtures.rs"]
mod macro_provenance_fixtures;
#[path = "public_api/nested_command_fixtures.rs"]
mod nested_command_fixtures;
#[path = "public_api/policy.rs"]
mod policy;
#[path = "public_api/policy_fixtures.rs"]
mod policy_fixtures;
#[path = "public_api/resolver_fixtures.rs"]
mod resolver_fixtures;
#[path = "public_api/source_fixtures.rs"]
mod source_fixtures;
#[path = "public_api/workspace.rs"]
mod workspace;

#[path = "public_api/item_macro_fixtures.rs"]
mod item_macro_fixtures;

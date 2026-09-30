//! Architecture guard for the crate-split effort.
//!
//! Parses every non-test file under `src/` with `syn`, records which
//! top-level modules each module reaches through `crate::<module>` paths,
//! folds that digraph onto the crate slices from
//! `studio/docs/crate-split-plan.md` §2, and asserts the slice graph is
//! acyclic once the shrinking [`ALLOWED_BACK_EDGES`] list is removed. Cargo
//! forbids cyclic crate dependencies, so a cycle here is a crate that cannot
//! be extracted.

mod module_graph_support;

use module_graph_support::{
    modules_declaring_tauri_commands, slice_of, ModuleGraph, ALLOWED_BACK_EDGES,
    ALLOWED_COMMAND_MODULES_OUTSIDE_DESKTOP,
};

#[test]
fn every_module_belongs_to_a_target_slice() {
    let graph = ModuleGraph::scan();
    let unassigned = graph.unassigned_modules();
    assert!(
        unassigned.is_empty(),
        "these `src/` modules have no entry in SLICES; give each one a target \
         crate in module_graph_support::SLICES: {unassigned:?}"
    );

    let stale = module_graph_support::stale_slice_entries();
    assert!(
        stale.is_empty(),
        "these SLICES entries name modules that are no longer under src/; they \
         have been extracted, so delete their entries: {stale:?}"
    );
}

#[test]
fn target_slice_graph_is_acyclic() {
    let graph = ModuleGraph::scan();

    let stale = graph.stale_allowlist_entries(ALLOWED_BACK_EDGES);
    assert!(
        stale.is_empty(),
        "these allowlisted back-edges no longer exist; delete them from \
         ALLOWED_BACK_EDGES so the list keeps shrinking: {stale:?}"
    );

    let cycles = graph.slice_cycles_excluding(ALLOWED_BACK_EDGES);
    assert!(
        cycles.is_empty(),
        "the target crate slices form a dependency cycle, which Cargo \
         forbids. Each line is one strongly connected component:\n{}",
        cycles
            .iter()
            .map(|component| component.join(" -> "))
            .collect::<Vec<_>>()
            .join("\n")
    );
}

#[test]
fn tauri_commands_live_only_in_the_desktop_shell() {
    let declaring = modules_declaring_tauri_commands();

    let stale: Vec<_> = ALLOWED_COMMAND_MODULES_OUTSIDE_DESKTOP
        .iter()
        .filter(|module| !declaring.iter().any(|found| found == *module))
        .collect();
    assert!(
        stale.is_empty(),
        "these modules no longer declare `#[tauri::command]`; delete them from \
         ALLOWED_COMMAND_MODULES_OUTSIDE_DESKTOP: {stale:?}"
    );

    let offenders: Vec<_> = declaring
        .iter()
        .filter(|module| slice_of(module).as_deref() != Some("desktop"))
        .filter(|module| !ALLOWED_COMMAND_MODULES_OUTSIDE_DESKTOP.contains(&module.as_str()))
        .collect();
    assert!(
        offenders.is_empty(),
        "`#[tauri::command]` is shell composition and belongs to the desktop \
         slice; found declarations in: {offenders:?}"
    );
}

/// Not an assertion: prints the current graph for crate-split work.
/// `cargo test --test module_graph -- --ignored --nocapture print_module_graph`
#[test]
#[ignore = "diagnostic printer for the crate-split migration"]
fn print_module_graph() {
    let graph = ModuleGraph::scan();
    for (from, to) in graph.edges() {
        println!("{from} -> {to}");
    }
    for component in graph.slice_cycles_excluding(ALLOWED_BACK_EDGES) {
        println!("SLICE CYCLE: {}", component.join(", "));
    }
}

//! Builds the `crate::<module>` dependency digraph for `src/`, folds it onto
//! the crate slices the split targets, and reports cycles. Shared by the
//! architecture guard tests; see `studio/docs/crate-split-plan.md`.

use std::collections::{BTreeMap, BTreeSet};
use std::path::{Path, PathBuf};

use syn::visit::Visit;
use syn::{Attribute, ImplItem, Item, Meta, UseTree};

/// The crate each top-level module moves into, from the target workspace
/// layout in `studio/docs/crate-split-plan.md` §2. Every module under `src/`
/// must appear here; a missing one fails [`crate::module_graph`]'s coverage
/// assertion so new modules get a home deliberately.
pub const SLICES: &[(&str, &str)] = &[
    ("entities", "entities"),
    ("diagnostics", "diagnostics"),
    ("data_directory", "data-directory"),
    ("tool_discovery", "tool-discovery"),
    ("settings_persistence", "settings"),
    ("work_management", "work-management"),
    ("module_links", "work-management"),
    ("runs_persistence", "runs-persistence"),
    ("runs", "runs-persistence"),
    ("hook_spool", "runs-persistence"),
    ("execution", "agent-execution"),
    ("graph_run_service", "agent-execution"),
    ("documents", "documents"),
    ("worktree", "workspace-runtime"),
    ("workspace", "workspace-runtime"),
    ("launch", "launch"),
    ("terminal", "terminal"),
    ("tmux_adapter", "terminal"),
    ("viewer_ownership", "terminal"),
    ("temporary_profile", "terminal"),
    ("installation", "installation"),
    ("graphql_foundation", "graphql-schema"),
    ("query_root", "graphql-schema"),
    ("desktop", "desktop"),
    ("native_terminal", "desktop"),
    ("app_updates", "desktop"),
];

/// Module references that still contradict the target slice DAG.
///
/// This list may only shrink: each entry is one Phase-1 untangle from the
/// crate-split plan, and a stale entry fails the guard so the list cannot
/// drift. Adding an entry means a new cycle was introduced.
pub const ALLOWED_BACK_EDGES: &[(&str, &str)] = &[
    // §3.4 code motion out of `work_management` and the remaining pairs
    ("documents", "workspace"),
    ("settings_persistence", "work_management"),
    ("work_management", "execution"),
    ("work_management", "graph_run_service"),
    ("work_management", "launch"),
    ("work_management", "runs_persistence"),
    ("work_management", "terminal"),
    ("work_management", "worktree"),
    ("worktree", "terminal"),
];

/// Files and directories that are not part of the module graph.
const IGNORED_ROOTS: &[&str] = &["bin", "lib.rs", "main.rs"];

pub struct ModuleGraph {
    edges: BTreeMap<String, BTreeSet<String>>,
}

impl ModuleGraph {
    pub fn scan() -> Self {
        let source_root = source_root();
        let mut edges = BTreeMap::new();
        for module in top_level_modules(&source_root) {
            let mut reached = BTreeSet::new();
            for file in module_files(&source_root, &module) {
                let text = std::fs::read_to_string(&file)
                    .unwrap_or_else(|error| panic!("read {}: {error}", file.display()));
                let parsed = syn::parse_file(&text)
                    .unwrap_or_else(|error| panic!("parse {}: {error}", file.display()));
                let mut collector = CrateReferences::default();
                collector.visit_file(&parsed);
                reached.extend(collector.reached);
            }
            reached.remove(&module);
            edges.insert(module, reached);
        }
        Self { edges }
    }

    pub fn edges(&self) -> impl Iterator<Item = (&str, &str)> {
        self.edges.iter().flat_map(|(from, targets)| {
            targets
                .iter()
                .map(move |to| (from.as_str(), to.as_str()))
        })
    }

    pub fn stale_allowlist_entries(&self, allowed: &[(&str, &str)]) -> Vec<String> {
        allowed
            .iter()
            .filter(|(from, to)| {
                !self
                    .edges
                    .get(*from)
                    .is_some_and(|targets| targets.contains(*to))
            })
            .map(|(from, to)| format!("{from} -> {to}"))
            .collect()
    }

    /// Modules with no entry in [`SLICES`].
    pub fn unassigned_modules(&self) -> Vec<&str> {
        self.edges
            .keys()
            .map(String::as_str)
            .filter(|module| slice_of(module).is_none())
            .collect()
    }

    /// Strongly connected components of the *slice* graph, after dropping the
    /// `allowed` module edges. Components of size 1 are omitted: edges inside
    /// one slice are edges inside one future crate, which Cargo permits.
    pub fn slice_cycles_excluding(&self, allowed: &[(&str, &str)]) -> Vec<Vec<String>> {
        let allowed: BTreeSet<(&str, &str)> = allowed.iter().copied().collect();
        let mut slice_edges: BTreeMap<&str, BTreeSet<&str>> = BTreeMap::new();
        for (_, slice) in SLICES {
            slice_edges.entry(slice).or_default();
        }
        for (from, to) in self.edges() {
            if allowed.contains(&(from, to)) {
                continue;
            }
            let (Some(from_slice), Some(to_slice)) = (slice_of(from), slice_of(to)) else {
                continue;
            };
            if from_slice != to_slice {
                slice_edges.entry(from_slice).or_default().insert(to_slice);
            }
        }
        let adjacency: BTreeMap<&str, Vec<&str>> = slice_edges
            .into_iter()
            .map(|(slice, targets)| (slice, targets.into_iter().collect()))
            .collect();
        strongly_connected_components(&adjacency)
            .into_iter()
            .filter(|component| component.len() > 1)
            .map(|component| component.into_iter().map(str::to_owned).collect())
            .collect()
    }
}

pub fn slice_of(module: &str) -> Option<&'static str> {
    SLICES
        .iter()
        .find(|(name, _)| *name == module)
        .map(|(_, slice)| *slice)
}

/// Modules that still declare `#[tauri::command]` outside the desktop shell.
///
/// Commands are shell composition by definition, so `desktop` is their only
/// home. This list may only shrink; see the crate-split plan §3.3.
pub const ALLOWED_COMMAND_MODULES_OUTSIDE_DESKTOP: &[&str] = &[];

/// Top-level modules that declare at least one `#[tauri::command]`.
pub fn modules_declaring_tauri_commands() -> Vec<String> {
    let source_root = source_root();
    top_level_modules(&source_root)
        .into_iter()
        .filter(|module| {
            module_files(&source_root, module).into_iter().any(|file| {
                std::fs::read_to_string(&file)
                    .is_ok_and(|text| text.contains("#[tauri::command]"))
            })
        })
        .collect()
}

fn source_root() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("src")
}

fn top_level_modules(source_root: &Path) -> Vec<String> {
    let mut modules = BTreeSet::new();
    for entry in std::fs::read_dir(source_root).expect("read src/") {
        let entry = entry.expect("read src/ entry");
        let name = entry.file_name().to_string_lossy().into_owned();
        if IGNORED_ROOTS.contains(&name.as_str()) {
            continue;
        }
        if entry.path().is_dir() {
            modules.insert(name);
        } else if let Some(stem) = name.strip_suffix(".rs") {
            modules.insert(stem.to_owned());
        }
    }
    modules.into_iter().collect()
}

/// Every non-test `.rs` file that belongs to `module`, i.e. `src/<module>.rs`
/// plus everything under `src/<module>/`.
fn module_files(source_root: &Path, module: &str) -> Vec<PathBuf> {
    let mut files = Vec::new();
    let root_file = source_root.join(format!("{module}.rs"));
    if root_file.is_file() {
        files.push(root_file);
    }
    collect_rust_files(&source_root.join(module), &mut files);
    files.retain(|file| !is_test_file(file));
    files
}

fn collect_rust_files(directory: &Path, files: &mut Vec<PathBuf>) {
    let Ok(entries) = std::fs::read_dir(directory) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            collect_rust_files(&path, files);
        } else if path.extension().is_some_and(|extension| extension == "rs") {
            files.push(path);
        }
    }
}

fn is_test_file(path: &Path) -> bool {
    let stem = path
        .file_stem()
        .map(|stem| stem.to_string_lossy().into_owned())
        .unwrap_or_default();
    stem == "tests"
        || stem.ends_with("_tests")
        || stem.ends_with("_test")
        || path
            .components()
            .any(|component| component.as_os_str() == "tests")
}

#[derive(Default)]
struct CrateReferences {
    reached: BTreeSet<String>,
}

impl<'ast> Visit<'ast> for CrateReferences {
    fn visit_item(&mut self, item: &'ast Item) {
        if is_test_only(item_attributes(item)) {
            return;
        }
        syn::visit::visit_item(self, item);
    }

    fn visit_impl_item(&mut self, item: &'ast ImplItem) {
        if is_test_only(impl_item_attributes(item)) {
            return;
        }
        syn::visit::visit_impl_item(self, item);
    }

    fn visit_item_use(&mut self, item: &'ast syn::ItemUse) {
        if is_test_only(&item.attrs) || item.leading_colon.is_some() {
            return;
        }
        collect_use_tree(&item.tree, false, &mut self.reached);
    }

    fn visit_path(&mut self, path: &'ast syn::Path) {
        if path.leading_colon.is_none()
            && path.segments.len() >= 2
            && path.segments[0].ident == "crate"
        {
            self.reached
                .insert(path.segments[1].ident.to_string());
        }
        syn::visit::visit_path(self, path);
    }
}

fn collect_use_tree(tree: &UseTree, after_crate: bool, reached: &mut BTreeSet<String>) {
    match tree {
        UseTree::Path(path) => {
            if after_crate {
                reached.insert(path.ident.to_string());
            } else if path.ident == "crate" {
                collect_use_tree(&path.tree, true, reached);
            }
        }
        UseTree::Name(name) if after_crate => {
            reached.insert(name.ident.to_string());
        }
        UseTree::Rename(rename) if after_crate => {
            reached.insert(rename.ident.to_string());
        }
        UseTree::Group(group) => {
            for item in &group.items {
                collect_use_tree(item, after_crate, reached);
            }
        }
        _ => {}
    }
}

fn is_test_only(attributes: &[Attribute]) -> bool {
    attributes.iter().any(|attribute| {
        if attribute.path().is_ident("test") {
            return true;
        }
        if !attribute.path().is_ident("cfg") {
            return false;
        }
        match &attribute.meta {
            Meta::List(list) => list.tokens.to_string().contains("test"),
            _ => false,
        }
    })
}

fn item_attributes(item: &Item) -> &[Attribute] {
    match item {
        Item::Const(inner) => &inner.attrs,
        Item::Enum(inner) => &inner.attrs,
        Item::ExternCrate(inner) => &inner.attrs,
        Item::Fn(inner) => &inner.attrs,
        Item::ForeignMod(inner) => &inner.attrs,
        Item::Impl(inner) => &inner.attrs,
        Item::Macro(inner) => &inner.attrs,
        Item::Mod(inner) => &inner.attrs,
        Item::Static(inner) => &inner.attrs,
        Item::Struct(inner) => &inner.attrs,
        Item::Trait(inner) => &inner.attrs,
        Item::TraitAlias(inner) => &inner.attrs,
        Item::Type(inner) => &inner.attrs,
        Item::Union(inner) => &inner.attrs,
        Item::Use(inner) => &inner.attrs,
        _ => &[],
    }
}

fn impl_item_attributes(item: &ImplItem) -> &[Attribute] {
    match item {
        ImplItem::Const(inner) => &inner.attrs,
        ImplItem::Fn(inner) => &inner.attrs,
        ImplItem::Type(inner) => &inner.attrs,
        ImplItem::Macro(inner) => &inner.attrs,
        _ => &[],
    }
}

/// Tarjan's algorithm, iterative-free recursive form over a small graph.
fn strongly_connected_components<'a>(
    graph: &BTreeMap<&'a str, Vec<&'a str>>,
) -> Vec<Vec<&'a str>> {
    struct State<'a> {
        index: usize,
        indices: BTreeMap<&'a str, usize>,
        low: BTreeMap<&'a str, usize>,
        stack: Vec<&'a str>,
        on_stack: BTreeSet<&'a str>,
        components: Vec<Vec<&'a str>>,
    }

    fn strong_connect<'a>(
        node: &'a str,
        graph: &BTreeMap<&'a str, Vec<&'a str>>,
        state: &mut State<'a>,
    ) {
        state.indices.insert(node, state.index);
        state.low.insert(node, state.index);
        state.index += 1;
        state.stack.push(node);
        state.on_stack.insert(node);

        for next in graph.get(node).into_iter().flatten() {
            if !state.indices.contains_key(next) {
                strong_connect(next, graph, state);
                let low = state.low[next];
                let current = state.low[node];
                state.low.insert(node, current.min(low));
            } else if state.on_stack.contains(next) {
                let index = state.indices[next];
                let current = state.low[node];
                state.low.insert(node, current.min(index));
            }
        }

        if state.low[node] == state.indices[node] {
            let mut component = Vec::new();
            while let Some(member) = state.stack.pop() {
                state.on_stack.remove(member);
                component.push(member);
                if member == node {
                    break;
                }
            }
            state.components.push(component);
        }
    }

    let mut state = State {
        index: 0,
        indices: BTreeMap::new(),
        low: BTreeMap::new(),
        stack: Vec::new(),
        on_stack: BTreeSet::new(),
        components: Vec::new(),
    };
    for node in graph.keys() {
        if !state.indices.contains_key(node) {
            strong_connect(node, graph, &mut state);
        }
    }
    state.components
}

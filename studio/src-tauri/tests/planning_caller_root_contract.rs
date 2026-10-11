//! The planning caller batch must be ready before compatibility contraction.
use std::{fs, path::Path};
use syn::{visit::Visit, UseTree};

#[derive(Default)]
struct CommandPaths(Vec<String>);

impl CommandPaths {
    fn record(&mut self, segments: &[String]) {
        if segments
            .windows(2)
            .any(|pair| pair[0] == "ticketry_work_management" && pair[1] == "commands")
        {
            self.0.push(segments.join("::"));
        }
    }

    fn inspect_use(&mut self, tree: &UseTree, prefix: &[String]) {
        match tree {
            UseTree::Path(path) => {
                let mut segments = prefix.to_vec();
                segments.push(path.ident.to_string());
                self.inspect_use(&path.tree, &segments);
            }
            UseTree::Group(group) => {
                for item in &group.items {
                    self.inspect_use(item, prefix);
                }
            }
            UseTree::Name(name) => {
                let mut segments = prefix.to_vec();
                segments.push(name.ident.to_string());
                self.record(&segments);
            }
            UseTree::Rename(rename) => {
                let mut segments = prefix.to_vec();
                segments.push(rename.ident.to_string());
                self.record(&segments);
            }
            UseTree::Glob(_) => self.record(prefix),
        }
    }
}

impl<'ast> Visit<'ast> for CommandPaths {
    fn visit_item_use(&mut self, item: &'ast syn::ItemUse) {
        self.inspect_use(&item.tree, &[]);
    }

    fn visit_path(&mut self, path: &'ast syn::Path) {
        self.record(
            &path
                .segments
                .iter()
                .map(|segment| segment.ident.to_string())
                .collect::<Vec<_>>(),
        );
        syn::visit::visit_path(self, path);
    }
}

fn inspect_callers(directory: &Path, violations: &mut Vec<String>) {
    for entry in fs::read_dir(directory).expect("read caller directory") {
        let path = entry.expect("caller directory entry").path();
        if path.is_dir() {
            if !matches!(
                path.file_name().and_then(|name| name.to_str()),
                Some("target" | "ticketry-work-management")
            ) {
                inspect_callers(&path, violations);
            }
        } else if path.extension().is_some_and(|extension| extension == "rs") {
            let source = fs::read_to_string(&path).expect("read Rust caller");
            if !source.contains("ticketry_work_management") {
                continue;
            }
            let syntax = syn::parse_file(&source).expect("parse Rust caller");
            let mut paths = CommandPaths::default();
            paths.visit_file(&syntax);
            violations.extend(
                paths
                    .0
                    .into_iter()
                    .map(|item| format!("{}: {item}", path.display())),
            );
        }
    }
}

#[test]
fn planning_callers_use_approved_root_capabilities() {
    let workspace = Path::new(env!("CARGO_MANIFEST_DIR"));
    let mut violations = Vec::new();
    for directory in ["crates", "src", "tests"] {
        inspect_callers(&workspace.join(directory), &mut violations);
    }
    assert!(
        violations.is_empty(),
        "planning callers still depend on compatibility namespaces:\n{}",
        violations.join("\n")
    );
}

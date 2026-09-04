use std::collections::{BTreeMap, BTreeSet};
use std::fs;
use std::path::{Path, PathBuf};

use syn::{Item, UseTree, Visibility};

const APPROVED_API: &str = include_str!("fixtures/public-api.txt");

#[test]
fn library_roots_are_the_only_public_facades() {
    let manifest_dir = Path::new(env!("CARGO_MANIFEST_DIR"));
    let roots = library_roots(manifest_dir);
    let mut actual = BTreeMap::<String, BTreeSet<String>>::new();
    let mut public_modules = Vec::new();
    let mut glob_exports = Vec::new();

    for (crate_name, path) in roots {
        let source = fs::read_to_string(&path)
            .unwrap_or_else(|error| panic!("cannot read {}: {error}", path.display()));
        let syntax = syn::parse_file(&source)
            .unwrap_or_else(|error| panic!("cannot parse {}: {error}", path.display()));
        let exports = actual.entry(crate_name).or_default();

        for item in syntax.items {
            match item {
                Item::Mod(item) if is_public(&item.vis) => {
                    public_modules.push(format!("{}: pub mod {}", path.display(), item.ident));
                }
                Item::Use(item) if is_public(&item.vis) => {
                    collect_use_exports(&item.tree, None, exports, &mut glob_exports, &path);
                }
                Item::Const(item) if is_public(&item.vis) => {
                    exports.insert(item.ident.to_string());
                }
                Item::Enum(item) if is_public(&item.vis) => {
                    exports.insert(item.ident.to_string());
                }
                Item::ExternCrate(item) if is_public(&item.vis) => {
                    exports.insert(
                        item.rename
                            .map(|(_, rename)| rename.to_string())
                            .unwrap_or_else(|| item.ident.to_string()),
                    );
                }
                Item::Fn(item) if is_public(&item.vis) => {
                    exports.insert(item.sig.ident.to_string());
                }
                Item::Static(item) if is_public(&item.vis) => {
                    exports.insert(item.ident.to_string());
                }
                Item::Struct(item) if is_public(&item.vis) => {
                    exports.insert(item.ident.to_string());
                }
                Item::Trait(item) if is_public(&item.vis) => {
                    exports.insert(item.ident.to_string());
                }
                Item::TraitAlias(item) if is_public(&item.vis) => {
                    exports.insert(item.ident.to_string());
                }
                Item::Type(item) if is_public(&item.vis) => {
                    exports.insert(item.ident.to_string());
                }
                Item::Union(item) if is_public(&item.vis) => {
                    exports.insert(item.ident.to_string());
                }
                _ => {}
            }
        }
    }

    actual.retain(|_, exports| !exports.is_empty());

    assert!(
        public_modules.is_empty(),
        "library roots must declare implementation modules with `mod`:\n{}",
        public_modules.join("\n")
    );
    assert!(
        glob_exports.is_empty(),
        "facades must name every export instead of using glob exports:\n{}",
        glob_exports.join("\n")
    );
    if std::env::var_os("UPDATE_PUBLIC_API").is_some() {
        write_approved_api(manifest_dir, &actual);
        return;
    }
    assert_eq!(actual, approved_api());
}

fn write_approved_api(manifest_dir: &Path, actual: &BTreeMap<String, BTreeSet<String>>) {
    let mut output = String::from(
        "# One `crate|exported_name` approval per public library-root item.\n\
# Keep entries sorted first by crate, then by exported name.\n",
    );
    for (crate_name, exports) in actual {
        for export in exports {
            output.push_str(crate_name);
            output.push('|');
            output.push_str(export);
            output.push('\n');
        }
    }
    let path = manifest_dir.join("tests/fixtures/public-api.txt");
    fs::write(&path, output)
        .unwrap_or_else(|error| panic!("cannot update {}: {error}", path.display()));
}

fn library_roots(manifest_dir: &Path) -> Vec<(String, PathBuf)> {
    let mut roots = vec![("ticketry".to_owned(), manifest_dir.join("src/lib.rs"))];
    let crates_dir = manifest_dir.join("crates");
    for tier_entry in fs::read_dir(&crates_dir)
        .unwrap_or_else(|error| panic!("cannot read {}: {error}", crates_dir.display()))
    {
        let tier = tier_entry.expect("tier directory entry").path();
        for crate_entry in fs::read_dir(&tier)
            .unwrap_or_else(|error| panic!("cannot read {}: {error}", tier.display()))
        {
            let path = crate_entry.expect("crate directory entry").path();
            let manifest = path.join("Cargo.toml");
            let lib = path.join("src/lib.rs");
            if !manifest.is_file() || !lib.is_file() {
                continue;
            }
            let text = fs::read_to_string(&manifest)
                .unwrap_or_else(|error| panic!("cannot read {}: {error}", manifest.display()));
            let name = text
                .lines()
                .find_map(|line| line.strip_prefix("name = \"")?.strip_suffix('"'))
                .unwrap_or_else(|| panic!("{} has no package name", manifest.display()));
            roots.push((name.to_owned(), lib));
        }
    }
    roots.sort_by(|left, right| left.0.cmp(&right.0));
    assert_eq!(
        roots.len(),
        19,
        "public API audit must scan the root and 18 crates"
    );
    roots
}

fn is_public(visibility: &Visibility) -> bool {
    matches!(visibility, Visibility::Public(_))
}

fn collect_use_exports(
    tree: &UseTree,
    prefix: Option<&str>,
    exports: &mut BTreeSet<String>,
    glob_exports: &mut Vec<String>,
    path: &Path,
) {
    match tree {
        UseTree::Path(path_tree) => collect_use_exports(
            &path_tree.tree,
            Some(&path_tree.ident.to_string()),
            exports,
            glob_exports,
            path,
        ),
        UseTree::Name(name) => {
            let exported = if name.ident == "self" {
                prefix.expect("self import has a path").to_owned()
            } else {
                name.ident.to_string()
            };
            exports.insert(exported);
        }
        UseTree::Rename(rename) => {
            exports.insert(rename.rename.to_string());
        }
        UseTree::Group(group) => {
            for item in &group.items {
                collect_use_exports(item, prefix, exports, glob_exports, path);
            }
        }
        UseTree::Glob(_) => glob_exports.push(path.display().to_string()),
    }
}

fn approved_api() -> BTreeMap<String, BTreeSet<String>> {
    let mut approved = BTreeMap::<String, BTreeSet<String>>::new();
    for line in APPROVED_API.lines() {
        let line = line.trim();
        if line.is_empty() || line.starts_with('#') {
            continue;
        }
        let (crate_name, export) = line
            .split_once('|')
            .unwrap_or_else(|| panic!("invalid public API approval: {line}"));
        approved
            .entry(crate_name.to_owned())
            .or_default()
            .insert(export.to_owned());
    }
    approved
}

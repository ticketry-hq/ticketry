use syn::ext::IdentExt;
use syn::UseTree;

pub(super) fn flatten_use(
    tree: &UseTree,
    prefix: &[String],
    output: &mut Vec<(String, Vec<String>, bool)>,
) {
    match tree {
        UseTree::Path(path) => {
            let mut prefix = prefix.to_vec();
            prefix.push(path.ident.unraw().to_string());
            flatten_use(&path.tree, &prefix, output);
        }
        UseTree::Name(name) => {
            let mut path = prefix.to_vec();
            if name.ident != "self" {
                path.push(name.ident.unraw().to_string());
            }
            output.push((
                path.last().cloned().unwrap_or_else(|| "self".into()),
                path,
                false,
            ));
        }
        UseTree::Rename(rename) => {
            let mut path = prefix.to_vec();
            if rename.ident != "self" {
                path.push(rename.ident.unraw().to_string());
            }
            output.push((rename.rename.unraw().to_string(), path, false));
        }
        UseTree::Group(group) => {
            for item in &group.items {
                flatten_use(item, prefix, output);
            }
        }
        UseTree::Glob(_) => output.push(("*".into(), prefix.to_vec(), true)),
    }
}

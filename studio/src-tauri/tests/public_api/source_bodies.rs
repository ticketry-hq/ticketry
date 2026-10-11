use syn::buffer::{Cursor, TokenBuffer};
use syn::ext::IdentExt;
use syn::visit::Visit;
use syn::{Item, Macro};

use super::{attributes, item_attributes, source_imports};

#[derive(Default)]
pub(super) struct BodyEvidence {
    pub errors: Vec<String>,
    pub macros: Vec<Vec<String>>,
    pub attributes: Vec<Vec<String>>,
    pub bindings: Vec<String>,
    pub opaque_imports: bool,
}

pub(super) fn inspect(item: &Item) -> BodyEvidence {
    let mut visitor = BodyExports {
        root: true,
        evidence: BodyEvidence::default(),
    };
    visitor.visit_item(item);
    visitor.evidence
}

struct BodyExports {
    root: bool,
    evidence: BodyEvidence,
}

impl BodyExports {
    fn associated_attributes(&mut self, attributes: &[syn::Attribute]) {
        let evidence = attributes::inspect(attributes);
        if evidence.macro_export || evidence.root_command_macros || evidence.mobile_entry {
            self.evidence.errors.push("unsupported root-exporting attribute on an associated item; add explicit expansion handling and compiler evidence".into());
        }
        self.evidence
            .attributes
            .extend(evidence.macro_references.into_iter().map(|(path, _)| path));
        self.evidence.errors.extend(evidence.errors);
    }
}

impl<'ast> Visit<'ast> for BodyExports {
    fn visit_impl_item(&mut self, item: &'ast syn::ImplItem) {
        let attributes: &[syn::Attribute] = match item {
            syn::ImplItem::Const(item) => &item.attrs,
            syn::ImplItem::Fn(item) => &item.attrs,
            syn::ImplItem::Type(item) => &item.attrs,
            syn::ImplItem::Macro(item) => &item.attrs,
            _ => &[],
        };
        self.associated_attributes(attributes);
        syn::visit::visit_impl_item(self, item);
    }

    fn visit_trait_item(&mut self, item: &'ast syn::TraitItem) {
        let attributes: &[syn::Attribute] = match item {
            syn::TraitItem::Const(item) => &item.attrs,
            syn::TraitItem::Fn(item) => &item.attrs,
            syn::TraitItem::Type(item) => &item.attrs,
            syn::TraitItem::Macro(item) => &item.attrs,
            _ => &[],
        };
        self.associated_attributes(attributes);
        syn::visit::visit_trait_item(self, item);
    }

    fn visit_item(&mut self, item: &'ast Item) {
        if self.root {
            self.root = false;
        } else {
            let evidence = attributes::inspect(item_attributes(item));
            if evidence.macro_export {
                self.evidence.errors.push("unsupported macro_export declaration nested in a body; add explicit root inventory handling and compile evidence".into());
            }
            if !evidence.macro_references.is_empty() {
                self.evidence.attributes.extend(
                    evidence
                        .macro_references
                        .iter()
                        .map(|(path, _)| path.clone()),
                );
            }
            self.evidence.errors.extend(evidence.errors);
            match item {
                Item::Use(item) => {
                    let mut bindings = Vec::new();
                    source_imports::flatten_use(&item.tree, &[], &mut bindings);
                    for (name, _, glob) in bindings {
                        if glob {
                            self.evidence.opaque_imports = true;
                        } else {
                            self.evidence.bindings.push(name);
                        }
                    }
                }
                Item::Mod(item) => self.evidence.bindings.push(item.ident.unraw().to_string()),
                Item::ExternCrate(item) => self.evidence.bindings.push(
                    item.rename
                        .as_ref()
                        .map(|(_, name)| name.unraw().to_string())
                        .unwrap_or_else(|| item.ident.unraw().to_string()),
                ),
                Item::Macro(item) => {
                    if let Some(name) = &item.ident {
                        self.evidence.bindings.push(name.unraw().to_string());
                    }
                }
                _ => {}
            }
        }
        syn::visit::visit_item(self, item);
    }

    fn visit_macro(&mut self, mac: &'ast Macro) {
        let path = mac
            .path
            .segments
            .iter()
            .map(|part| part.ident.unraw().to_string())
            .collect::<Vec<_>>();
        if path != ["macro_rules"] {
            self.evidence.macros.push(path);
        }
        let tokens = TokenBuffer::new2(mac.tokens.clone());
        if token_attribute_escape(tokens.begin(), &mut self.evidence.macros) {
            self.evidence.errors.push("unsupported macro_export, procedural attribute, or local import/item scope inside opaque macro arguments; add explicit expansion handling and compile evidence".into());
        }
    }
}

fn token_attribute_escape(mut cursor: Cursor<'_>, macros: &mut Vec<Vec<String>>) -> bool {
    while !cursor.eof() {
        if let Some((ident, _)) = cursor.ident() {
            if ["use", "extern", "mod", "macro_rules"].contains(&ident.unraw().to_string().as_str())
            {
                return true;
            }
        }
        if let Some((path, arguments)) = token_macro_path(cursor) {
            macros.push(path);
            cursor = arguments;
        }
        if let Some((punct, after)) = cursor.punct() {
            if punct.as_char() == '#' {
                if let Some((inside, _, _, _)) = after.any_group() {
                    if let Ok(meta) = syn::parse2::<syn::Meta>(inside.token_stream()) {
                        let evidence = attributes::inspect_meta(&meta);
                        if evidence.macro_export
                            || !evidence.macro_references.is_empty()
                            || !evidence.errors.is_empty()
                        {
                            return true;
                        }
                    }
                }
            }
        }
        if let Some((inside, _, _, after)) = cursor.any_group() {
            if token_attribute_escape(inside, macros) {
                return true;
            }
            cursor = after;
        } else if let Some((_, after)) = cursor.token_tree() {
            cursor = after;
        } else {
            break;
        }
    }
    false
}

fn token_macro_path(mut cursor: Cursor<'_>) -> Option<(Vec<String>, Cursor<'_>)> {
    let (ident, after) = cursor.ident()?;
    let mut path = vec![ident.unraw().to_string()];
    cursor = after;
    loop {
        let (punct, after) = cursor.punct()?;
        if punct.as_char() == '!' && after.any_group().is_some() {
            return Some((path, after));
        }
        if punct.as_char() != ':' {
            return None;
        }
        let (colon, after) = after.punct()?;
        if colon.as_char() != ':' {
            return None;
        }
        let (ident, after) = after.ident()?;
        path.push(ident.unraw().to_string());
        cursor = after;
    }
}

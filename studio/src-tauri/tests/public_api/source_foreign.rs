use super::{attributes, public, BindingKind, Loader};
use syn::ext::IdentExt;

impl Loader {
    pub(super) fn foreign(
        &mut self,
        module: usize,
        items: &[syn::ForeignItem],
        inherited: &[String],
    ) {
        for item in items {
            let (name, visibility, kind, attrs) = match item {
                syn::ForeignItem::Fn(item) => (&item.sig.ident, &item.vis, "fn", &item.attrs),
                syn::ForeignItem::Static(item) => (&item.ident, &item.vis, "static", &item.attrs),
                syn::ForeignItem::Type(item) => (&item.ident, &item.vis, "type", &item.attrs),
                _ => {
                    self.error(module, "unsupported foreign item expansion; add explicit handling and compile evidence".into());
                    continue;
                }
            };
            let evidence = attributes::inspect(attrs);
            for error in evidence.errors {
                self.error(module, error);
            }
            let mut gates = inherited.to_vec();
            gates.extend(evidence.gates);
            self.bind(
                module,
                name.unraw().to_string(),
                public(visibility),
                BindingKind::Leaf(kind.into()),
                gates,
            );
        }
    }
}

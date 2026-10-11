//! Explicit item expansions verified against the pinned framework implementations.
//! Tokio task_local emits one static LocalKey per declaration; std thread_local
//! emits one static LocalKey per declaration. Seaography's registration macro
//! emits exactly one public register_entity_modules function and no namespace.
use syn::ext::IdentExt;
use syn::parse::{Parse, ParseStream};
use syn::{Attribute, Item, ItemStatic, Macro, StaticMutability, Token, Type, Visibility};

pub(super) fn expand(mac: &Macro) -> Result<Option<Vec<Item>>, String> {
    let path = mac
        .path
        .segments
        .iter()
        .map(|part| part.ident.unraw().to_string())
        .collect::<Vec<_>>();
    let result = match path.iter().map(String::as_str).collect::<Vec<_>>().as_slice() {
        ["tokio", "task_local"] => syn::parse2::<TaskLocals>(mac.tokens.clone()).map(|keys| keys.0),
        ["thread_local"] | ["std", "thread_local"] => syn::parse2::<ThreadLocals>(mac.tokens.clone()).map(|keys| keys.0),
        ["seaography", "register_entity_modules"] => syn::parse2::<EntityModules>(mac.tokens.clone()).map(|_| vec![syn::parse_quote! {
            pub fn register_entity_modules(builder: seaography::Builder) -> seaography::Builder { builder }
        }]),
        _ => return Ok(None),
    };
    result.map(Some).map_err(|error| format!("unsupported item macro shape `{}`: {error}; reviewed expansion and compile evidence required", path.join("::")))
}

struct TaskLocals(Vec<Item>);
impl Parse for TaskLocals {
    fn parse(input: ParseStream<'_>) -> syn::Result<Self> {
        let mut keys = Vec::new();
        while !input.is_empty() {
            let attributes = input.call(Attribute::parse_outer)?;
            let visibility: Visibility = input.parse()?;
            input.parse::<Token![static]>()?;
            let name: syn::Ident = input.parse()?;
            input.parse::<Token![:]>()?;
            let ty: Type = input.parse()?;
            if !input.is_empty() {
                input.parse::<Token![;]>()?;
            }
            // The inert initializer is not compiler-generated source. It lets
            // the ordinary source walker inspect the real attributes/type;
            // the macro's LocalKey initializer introduces no public namespace.
            keys.push(syn::parse_quote! { #(#attributes)* #visibility static #name: #ty = (); });
        }
        Ok(Self(keys))
    }
}

struct ThreadLocals(Vec<Item>);
impl Parse for ThreadLocals {
    fn parse(input: ParseStream<'_>) -> syn::Result<Self> {
        let mut keys = Vec::new();
        while !input.is_empty() {
            let key: ItemStatic = input.parse()?;
            if matches!(key.mutability, StaticMutability::Mut(_)) {
                return Err(input.error("thread_local does not support static mut declarations"));
            }
            // Retain the real initializer so nested macro exports and opaque
            // procedural macros still fail ordinary body provenance checks.
            keys.push(Item::Static(key));
        }
        Ok(Self(keys))
    }
}

struct EntityModules;
impl Parse for EntityModules {
    fn parse(input: ParseStream<'_>) -> syn::Result<Self> {
        let content;
        syn::bracketed!(content in input);
        let modules = content.parse_terminated(syn::Ident::parse, Token![,])?;
        if modules.is_empty() || !input.is_empty() {
            return Err(
                input.error("expected a non-empty bracketed list of entity module identifiers")
            );
        }
        Ok(Self)
    }
}

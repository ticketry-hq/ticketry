//! The desktop command-list wrapper is an expression-only Tauri handler expansion.
//! Parse its single arm and path arguments; adding another expansion fails closed.
use syn::parse::{Parse, ParseStream};
use syn::{ItemMacro, Token};

pub(super) fn handler_wrapper(item: &ItemMacro) -> Result<bool, String> {
    if item
        .ident
        .as_ref()
        .is_none_or(|name| name != "native_invoke_handler")
    {
        return Ok(false);
    }
    syn::parse2::<HandlerArm>(item.mac.tokens.clone())
        .map(|_| true)
        .map_err(|error| format!("unsupported native handler macro expansion: {error}; explicit compiler evidence required"))
}

struct HandlerArm;
impl Parse for HandlerArm {
    fn parse(input: ParseStream<'_>) -> syn::Result<Self> {
        let parameters;
        syn::parenthesized!(parameters in input);
        let expected: proc_macro2::TokenStream =
            syn::parse_quote! { $($acceptance_command:path),* $(,)? };
        let actual: proc_macro2::TokenStream = parameters.parse()?;
        if !same_tokens(&actual, &expected) {
            return Err(input.error("unsupported wrapper parameters"));
        }
        input.parse::<Token![=>]>()?;
        let body;
        syn::braced!(body in input);
        let path: syn::Path = body.parse()?;
        if path
            .segments
            .iter()
            .map(|part| part.ident.to_string())
            .collect::<Vec<_>>()
            != ["tauri", "generate_handler"]
        {
            return Err(body.error("handler wrapper must call canonical Tauri generate_handler"));
        }
        body.parse::<Token![!]>()?;
        let commands;
        syn::bracketed!(commands in body);
        while !commands.is_empty() && !commands.peek(Token![$]) {
            commands.parse::<syn::Path>()?;
            commands.parse::<Token![,]>()?;
        }
        let remaining: proc_macro2::TokenStream = commands.parse()?;
        let expected: proc_macro2::TokenStream = syn::parse_quote! { $($acceptance_command),* };
        if input.peek(Token![;]) {
            input.parse::<Token![;]>()?;
        }
        if !same_tokens(&remaining, &expected) || !body.is_empty() || !input.is_empty() {
            return Err(input.error("unsupported handler body expansion"));
        }
        Ok(Self)
    }
}

fn same_tokens(left: &proc_macro2::TokenStream, right: &proc_macro2::TokenStream) -> bool {
    let left = left.clone().into_iter().collect::<Vec<_>>();
    let right = right.clone().into_iter().collect::<Vec<_>>();
    left.len() == right.len()
        && left
            .iter()
            .zip(&right)
            .all(|(left, right)| match (left, right) {
                (proc_macro2::TokenTree::Ident(left), proc_macro2::TokenTree::Ident(right)) => {
                    left == right
                }
                (proc_macro2::TokenTree::Punct(left), proc_macro2::TokenTree::Punct(right)) => {
                    left.as_char() == right.as_char()
                }
                (proc_macro2::TokenTree::Literal(left), proc_macro2::TokenTree::Literal(right)) => {
                    left.to_string() == right.to_string()
                }
                (proc_macro2::TokenTree::Group(left), proc_macro2::TokenTree::Group(right)) => {
                    left.delimiter() == right.delimiter()
                        && same_tokens(&left.stream(), &right.stream())
                }
                _ => false,
            })
}

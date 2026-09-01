use seaography::async_graphql::{dynamic::ResolverContext, Result};

pub(super) fn optional_string(ctx: &ResolverContext<'_>, argument: &str) -> Result<Option<String>> {
    match ctx.args.get(argument) {
        None => Ok(None),
        Some(value) if value.is_null() => Ok(None),
        Some(value) => Ok(Some(value.string()?.to_owned())),
    }
}

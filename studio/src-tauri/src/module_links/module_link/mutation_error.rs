use seaography::async_graphql::{Error, ErrorExtensions, Result};

use super::super::ModuleLinkError;
use crate::work_management::commands::CommandDatabase;

pub(super) fn require_write_ownership(
    ctx: &seaography::async_graphql::dynamic::ResolverContext<'_>,
) -> Result<()> {
    ctx.data::<CommandDatabase>().map(|_| ()).map_err(|_| {
        Error::new("Module Links cannot be written before write ownership transfers.").extend_with(
            |_, extension| {
                extension.set("code", "module_link_write_unavailable");
            },
        )
    })
}

pub(super) fn store_error(error: ModuleLinkError) -> Error {
    let code = error.code().as_str();
    let detail = error.to_string();
    Error::new(detail.clone())
        .extend_with(|_, extension| extension.set("code", code))
        .extend_with(move |_, extension| extension.set("detail", detail))
}

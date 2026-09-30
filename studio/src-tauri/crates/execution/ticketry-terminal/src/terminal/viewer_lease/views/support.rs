use seaography::async_graphql::{dynamic::ResolverContext, Error, Result};
use seaolim::{ErrorExtension, ModelWrite, PreparedModelWrite, WritePermit};

use crate::viewer_ownership::{
    PreparedViewerLeaseWrite, ViewerLeaseModelWrite, ViewerLeaseWritePermit, ViewerOwnershipError,
    ViewerOwnershipService,
};
use ticketry_entities::viewer_lease;

pub(super) fn service<'a>(ctx: &'a ResolverContext<'_>) -> Result<&'a ViewerOwnershipService> {
    ctx.data::<ViewerOwnershipService>().map_err(|_| {
        seaolim::mutation_error("Viewer ownership is unavailable.")
            .extension("code", "viewer_ownership_unavailable")
    })
}

pub(super) fn graphql_error(error: ViewerOwnershipError) -> Error {
    let code = error.code().as_str();
    seaolim::mutation_error(error.to_string()).extension("code", code)
}

pub(super) fn prepared_write(
    prepared: PreparedViewerLeaseWrite,
) -> PreparedModelWrite<viewer_lease::ActiveModel, viewer_lease::Model> {
    let write = match prepared.write {
        ViewerLeaseModelWrite::Insert(active) => ModelWrite::Insert(active),
        ViewerLeaseModelWrite::Update(active) => ModelWrite::Update(active),
        ViewerLeaseModelWrite::Delete {
            model,
            active_model,
        } => ModelWrite::Delete {
            model,
            active_model,
        },
        ViewerLeaseModelWrite::Noop => ModelWrite::Noop,
    };
    PreparedModelWrite::new(write, prepared.permit)
}

impl WritePermit for ViewerLeaseWritePermit {
    fn committed(self: Box<Self>) {
        (*self).committed();
    }
}

#![allow(non_snake_case)]

use seaography::{
    async_graphql::{Context, Error, ErrorExtensions, Result},
    CustomFields,
};

use crate::entities::terminals::viewer_lease;

use super::{
    CreateViewerLease, DeleteViewerLease, UpdateViewerLease, ViewerOwnershipError,
    ViewerOwnershipService,
};

pub struct ViewerLeaseMutations;

#[CustomFields]
impl ViewerLeaseMutations {
    async fn create_viewer_lease(
        ctx: &Context<'_>,
        agent_run_id: String,
        viewer_id: String,
        transport: String,
    ) -> Result<viewer_lease::Model> {
        service(ctx)?
            .create(CreateViewerLease {
                agent_run_id,
                viewer_id,
                transport,
            })
            .await
            .map_err(graphql_error)
    }

    async fn update_viewer_lease(
        ctx: &Context<'_>,
        agent_run_id: String,
        viewer_id: String,
        generation: String,
    ) -> Result<viewer_lease::Model> {
        service(ctx)?
            .update(UpdateViewerLease {
                agent_run_id,
                viewer_id,
                generation,
            })
            .await
            .map_err(graphql_error)
    }

    async fn delete_viewer_lease(
        ctx: &Context<'_>,
        agent_run_id: String,
        viewer_id: String,
        generation: String,
    ) -> Result<Option<viewer_lease::Model>> {
        service(ctx)?
            .delete(DeleteViewerLease {
                agent_run_id,
                viewer_id,
                generation,
            })
            .await
            .map_err(graphql_error)
    }
}

pub(super) fn register(mut builder: seaography::Builder) -> seaography::Builder {
    builder.register_custom_mutation::<ViewerLeaseMutations>();
    builder
}

fn service<'a>(ctx: &'a Context<'a>) -> Result<&'a ViewerOwnershipService> {
    ctx.data::<ViewerOwnershipService>().map_err(|_| {
        Error::new("Viewer ownership is unavailable.")
            .extend_with(|_, extension| extension.set("code", "viewer_ownership_unavailable"))
    })
}

fn graphql_error(error: ViewerOwnershipError) -> Error {
    let code = error.code().as_str();
    Error::new(error.to_string()).extend_with(move |_, extension| extension.set("code", code))
}

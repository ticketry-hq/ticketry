//! Reconcile and list one module's scratch Design Document registry.

use seaography::{
    async_graphql::{Context, Result},
    Builder, CustomFields,
};

use crate::entities::documents::design_document;

use super::support::{documents_error, service};

struct RefreshScratchRegistryView;

#[CustomFields]
impl RefreshScratchRegistryView {
    async fn refresh_scratch_document_registry(
        ctx: &Context<'_>,
        module_id: String,
    ) -> Result<Vec<design_document::Model>> {
        service(ctx)?
            .refresh_scratch(&module_id)
            .await
            .map_err(documents_error)
    }
}

pub(super) fn register(builder: &mut Builder) {
    builder.register_custom_mutation::<RefreshScratchRegistryView>();
}

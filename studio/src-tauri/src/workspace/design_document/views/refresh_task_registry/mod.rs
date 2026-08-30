//! Reconcile and list one Work Item's Design Document registry.

use seaography::{
    async_graphql::{Context, Result},
    Builder, CustomFields,
};

use crate::{documents::TaskRegistryScope, entities::documents::design_document};

use super::support::{documents_error, service};

struct RefreshTaskRegistryView;

#[CustomFields]
impl RefreshTaskRegistryView {
    async fn refresh_task_document_registry(
        ctx: &Context<'_>,
        task_id: String,
        project_id: Option<String>,
        module_id: Option<String>,
    ) -> Result<Vec<design_document::Model>> {
        service(ctx)?
            .refresh_task(TaskRegistryScope {
                task_id,
                project_id,
                module_id,
            })
            .await
            .map_err(documents_error)
    }
}

pub(super) fn register(builder: &mut Builder) {
    builder.register_custom_mutation::<RefreshTaskRegistryView>();
}

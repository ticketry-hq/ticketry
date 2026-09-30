//! Authored Project aggregate deletion view.
//!
//! Seaolim's generated delete cannot order Work Item removal before protected
//! catalogue cleanup in one transaction. The existing command retains that
//! transaction; this module owns only the public GraphQL field.

use seaography::{
    async_graphql::{Context, Result},
    Builder, CustomFields,
};

use crate::work_management::{
    commands::catalog,
    graphql::{command_database, command_error},
};

struct DeleteProjectView;

#[CustomFields]
impl DeleteProjectView {
    async fn delete_project(ctx: &Context<'_>, id: String) -> Result<bool> {
        catalog::delete_project(command_database(ctx)?, &id)
            .await
            .map_err(command_error)?;
        Ok(true)
    }
}

pub(super) fn register(builder: &mut Builder) {
    builder.register_custom_mutation::<DeleteProjectView>();
}

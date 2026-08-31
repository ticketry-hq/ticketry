//! Authored Project aggregate creation view.
//!
//! Seaolim has no registrar for one transaction that creates a Project and its
//! reviewed State, Issue Type, transition, and launch-binding defaults. The
//! existing command retains that transaction; this module owns only the public
//! GraphQL field.

use seaography::{
    async_graphql::{Context, Result},
    Builder, CustomFields,
};

use crate::work_management::{
    commands::catalog,
    graphql::{authoritative_project, command_database, command_error},
};

struct CreateProjectView;

#[CustomFields]
impl CreateProjectView {
    async fn create_project(
        ctx: &Context<'_>,
        name: String,
        slug: String,
        description: Option<String>,
    ) -> Result<ticketry_entities::work_management::project::Model> {
        let database = command_database(ctx)?;
        let id = catalog::create_project(
            database,
            catalog::CreateProject {
                name,
                slug,
                description,
            },
        )
        .await
        .map_err(command_error)?;
        authoritative_project(database, &id).await
    }
}

pub(super) fn register(builder: &mut Builder) {
    builder.register_custom_mutation::<CreateProjectView>();
}

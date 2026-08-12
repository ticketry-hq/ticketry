#![allow(non_snake_case)]

use sea_orm::{ActiveModelTrait, EntityTrait, Set};
use seaography::{
    async_graphql::{Context, Error, ErrorExtensions, Result},
    CustomFields,
};

use super::entities::migration_probes;

pub struct FoundationMutations;

#[CustomFields]
impl FoundationMutations {
    async fn setMigrationProbe(ctx: &Context<'_>, value: String) -> Result<bool> {
        validate_probe(&value).map_err(graphql_error)?;
        let database = ctx.data::<sea_orm::DatabaseConnection>()?;
        match migration_probes::Entity::find_by_id(1)
            .one(database)
            .await
            .map_err(database_error)?
        {
            Some(model) => {
                let mut active: migration_probes::ActiveModel = model.into();
                active.value = Set(value);
                active.update(database).await.map_err(database_error)?;
            }
            None => {
                migration_probes::ActiveModel {
                    id: Set(1),
                    value: Set(value),
                }
                .insert(database)
                .await
                .map_err(database_error)?;
            }
        }
        Ok(true)
    }
}

struct ProbeDomainError {
    code: &'static str,
    message: String,
}

fn validate_probe(value: &str) -> std::result::Result<(), ProbeDomainError> {
    if value.trim().is_empty() || value.len() > 64 || value == "reject" {
        return Err(ProbeDomainError {
            code: "migration_probe_rejected",
            message: "The migration probe value is not accepted.".to_owned(),
        });
    }
    Ok(())
}

fn graphql_error(error: ProbeDomainError) -> Error {
    Error::new(error.message).extend_with(|_, extension| extension.set("code", error.code))
}

fn database_error(error: sea_orm::DbErr) -> Error {
    Error::new("The migration probe could not be stored.")
        .extend_with(|_, extension| extension.set("code", "foundation_storage_failed"))
        .extend_with(|_, extension| extension.set("detail", error.to_string()))
}

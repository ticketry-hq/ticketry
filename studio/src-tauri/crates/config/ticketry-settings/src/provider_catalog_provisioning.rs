//! Provider, model, and reasoning rows required by a new installation.

use std::collections::{BTreeMap, BTreeSet};

use sea_orm::{ActiveValue::NotSet, DatabaseConnection, DbErr, EntityTrait, Set, TransactionTrait};

use ticketry_entities::{agent_model, agent_model_reasoning_level, provider, reasoning_level};
use ticketry_provider::{provider_contract, Provider};

pub async fn provision(database: &DatabaseConnection) -> Result<(), DbErr> {
    let transaction = database.begin().await?;
    let mut reasoning_ids = BTreeMap::new();

    let reasoning_levels = Provider::ALL
        .into_iter()
        .flat_map(|provider| provider_contract(provider).installation_catalog().models)
        .flat_map(|model| model.efforts.iter().copied())
        .collect::<BTreeSet<_>>();
    for name in reasoning_levels {
        let id = new_id();
        reasoning_level::Entity::insert(reasoning_level::ActiveModel {
            id: Set(id.clone()),
            name: Set(name.to_owned()),
        })
        .exec(&transaction)
        .await?;
        reasoning_ids.insert(name, id);
    }

    for provider_kind in Provider::ALL {
        let contract = provider_contract(provider_kind);
        let metadata = contract.metadata();
        let catalog = contract.installation_catalog();
        let provider_id = new_id();
        provider::Entity::insert(provider::ActiveModel {
            id: Set(provider_id.clone()),
            slug: Set(metadata.slug.to_owned()),
            activated: Set(catalog.active_by_default),
            supports_unattended: Set(metadata.supports_unattended),
        })
        .exec(&transaction)
        .await?;

        for model in catalog.models {
            let model_id = new_id();
            agent_model::Entity::insert(agent_model::ActiveModel {
                id: Set(model_id.clone()),
                provider_id: Set(provider_id.clone()),
                name: Set(model.name.to_owned()),
            })
            .exec(&transaction)
            .await?;

            for level in model.efforts {
                agent_model_reasoning_level::Entity::insert(
                    agent_model_reasoning_level::ActiveModel {
                        id: NotSet,
                        agent_model_id: Set(model_id.clone()),
                        reasoning_level_id: Set(reasoning_ids[*level].clone()),
                    },
                )
                .exec(&transaction)
                .await?;
            }
        }
    }

    transaction.commit().await
}

fn new_id() -> String {
    uuid::Uuid::new_v4().simple().to_string()
}

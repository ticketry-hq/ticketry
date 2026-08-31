use sea_orm::{ColumnTrait, DatabaseConnection, EntityTrait, QueryFilter, QueryOrder, QuerySelect};

use ticketry_entities::{runs::agent_run, terminals::launch_material};

use super::{title, InstantRunTicket};

pub const INSTANT_RUN_TICKET_LIMIT: u64 = 100;

#[derive(Clone)]
pub struct InstantRunTicketQuery {
    database: DatabaseConnection,
}

impl InstantRunTicketQuery {
    pub fn new(database: DatabaseConnection) -> Self {
        Self { database }
    }

    pub async fn list(
        &self,
        project_id: &str,
        module_id: &str,
    ) -> Result<Vec<InstantRunTicket>, sea_orm::DbErr> {
        let rows = launch_material::Entity::find()
            .find_also_related(agent_run::Entity)
            .filter(launch_material::Column::ProjectId.eq(project_id))
            .filter(launch_material::Column::ModuleId.eq(module_id))
            .filter(launch_material::Column::Scope.eq("instant"))
            .filter(agent_run::Column::Id.is_not_null())
            .filter(agent_run::Column::EndedAt.is_null())
            .order_by_desc(launch_material::Column::CreatedAt)
            .order_by_desc(launch_material::Column::AgentRunId)
            .limit(INSTANT_RUN_TICKET_LIMIT)
            .all(&self.database)
            .await?;

        Ok(rows
            .into_iter()
            .filter_map(|(material, run)| {
                run.map(|run| InstantRunTicket {
                    agent_run_id: run.id,
                    title: title::from_prompt(material.prompt.as_deref()),
                    started_at: run.started_at,
                })
            })
            .collect())
    }
}

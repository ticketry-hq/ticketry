//! Validation and identity ownership for the WorkItem workspace-tab order.

use std::collections::{HashMap, HashSet};

use sea_orm::{
    ActiveModelTrait, ColumnTrait, ConnectionTrait, DatabaseConnection, DbBackend, EntityTrait,
    QueryFilter, QuerySelect, Set, Statement, TransactionTrait,
};
use serde::Serialize;

use super::commands::status_facts::{
    record_work_item, stamp, WorkFactRecorder, WorkItemChange, WorkItemIdentity,
};
use super::commands::{work_items, CommandError};
use ticketry_entities::issue;
use ticketry_entities::{agent_run, design_document};

#[derive(Clone, Debug, Eq, Hash, PartialEq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum WorkspaceTabKind {
    Details,
    Changes,
    Doc,
    Terminal,
}

#[derive(Clone, Debug, Eq, Hash, PartialEq, Serialize)]
pub struct WorkspaceTabIdentity {
    pub kind: WorkspaceTabKind,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub id: Option<String>,
}

pub fn parse(value: serde_json::Value) -> Result<Vec<WorkspaceTabIdentity>, CommandError> {
    let entries = value.as_array().ok_or_else(|| {
        CommandError::field("workspace_tab_order", "Workspace tab order must be a list.")
    })?;
    let mut parsed = Vec::with_capacity(entries.len());
    let mut seen = HashSet::with_capacity(entries.len());
    for entry in entries {
        let object = entry
            .as_object()
            .ok_or_else(|| malformed("Each tab must be an object."))?;
        if object.keys().any(|key| key != "kind" && key != "id") {
            return Err(malformed("A tab contains an unknown field."));
        }
        let kind = object
            .get("kind")
            .and_then(serde_json::Value::as_str)
            .ok_or_else(|| malformed("Each tab requires a string kind."))?;
        let identity = match kind {
            "details" | "changes" => {
                if object.contains_key("id") {
                    return Err(malformed(format!("{kind} must not include an id.")));
                }
                WorkspaceTabIdentity {
                    kind: if kind == "details" {
                        WorkspaceTabKind::Details
                    } else {
                        WorkspaceTabKind::Changes
                    },
                    id: None,
                }
            }
            "doc" | "terminal" => {
                let id = object
                    .get("id")
                    .and_then(serde_json::Value::as_str)
                    .map(str::trim)
                    .filter(|id| !id.is_empty())
                    .ok_or_else(|| malformed(format!("{kind} tabs require a string id.")))?;
                WorkspaceTabIdentity {
                    kind: if kind == "doc" {
                        WorkspaceTabKind::Doc
                    } else {
                        WorkspaceTabKind::Terminal
                    },
                    id: Some(id.to_owned()),
                }
            }
            _ => {
                return Err(malformed(
                    "A tab kind must be details, changes, doc, or terminal.",
                ))
            }
        };
        if !seen.insert(identity.clone()) {
            return Err(malformed("Workspace tab identities must be unique."));
        }
        parsed.push(identity);
    }
    Ok(parsed)
}

pub async fn update(
    database: &DatabaseConnection,
    id: &str,
    value: serde_json::Value,
    facts: Option<&WorkFactRecorder>,
) -> Result<String, CommandError> {
    let order = parse(value)?;
    let id = database_uuid(id)?;
    let transaction = database.begin().await?;

    // This is the transaction's first statement. It binds the concrete task
    // and takes SQLite's writer reservation before ownership checks, so two
    // tab-order saves serialize instead of both reading the same revision.
    let claimed = transaction
        .query_one_raw(Statement::from_sql_and_values(
            DbBackend::Sqlite,
            "UPDATE worktracker_issue SET state_revision = state_revision WHERE id = ? AND type = 'task' RETURNING project_id",
            [id.clone().into()],
        ))
        .await?
        .ok_or_else(|| CommandError::NotFound("Work item not found.".to_owned()))?;
    let project_id = claimed.try_get::<String>("", "project_id")?;
    let existing = issue::Entity::find_by_id(&id)
        .one(&transaction)
        .await?
        .filter(|row| row.r#type == "task")
        .ok_or_else(|| CommandError::NotFound("Work item not found.".to_owned()))?;
    let normalized = validate_ownership(&transaction, &id, order).await?;
    let stored = serde_json::to_value(&normalized)
        .map_err(|error| CommandError::Storage(error.to_string()))?;
    if existing.workspace_tab_order == stored {
        transaction.commit().await?;
        return Ok(id);
    }

    let revision = work_items::next_revision(&transaction, &project_id).await?;
    let identity = WorkItemIdentity::of(&existing);
    let now = super::commands::timestamp::now();
    let occurred_at = stamp(now);
    let mut active: issue::ActiveModel = existing.into();
    active.workspace_tab_order = Set(stored);
    active.state_revision = Set(revision);
    active.updated_at = Set(now.clone());
    active.update(&transaction).await?;
    record_work_item(
        facts,
        &transaction,
        identity.fact(WorkItemChange::Updated, revision, &occurred_at),
    )
    .await?;
    transaction.commit().await?;
    if let Some(facts) = facts {
        facts.wake();
    }
    Ok(id)
}

async fn validate_ownership(
    database: &impl ConnectionTrait,
    work_item_id: &str,
    order: Vec<WorkspaceTabIdentity>,
) -> Result<Vec<WorkspaceTabIdentity>, CommandError> {
    let document_ids = ids_for(&order, WorkspaceTabKind::Doc);
    let terminal_ids = ids_for(&order, WorkspaceTabKind::Terminal);
    let documents = owners_for_documents(database, &document_ids).await?;
    let terminals = owners_for_terminals(database, &terminal_ids).await?;
    let mut retained = Vec::with_capacity(order.len());
    for identity in order {
        let owner = match (&identity.kind, identity.id.as_deref()) {
            (WorkspaceTabKind::Details | WorkspaceTabKind::Changes, _) => {
                retained.push(identity);
                continue;
            }
            (WorkspaceTabKind::Doc, Some(id)) => documents.get(id),
            (WorkspaceTabKind::Terminal, Some(id)) => terminals.get(id),
            _ => unreachable!("parse constructs valid identities"),
        };
        match owner {
            Some(owner) if owner == work_item_id => retained.push(identity),
            Some(_) => {
                return Err(CommandError::ForeignScope(
                    "A workspace tab identity belongs to another work item.".to_owned(),
                ))
            }
            None => {}
        }
    }
    Ok(retained)
}

fn ids_for(order: &[WorkspaceTabIdentity], kind: WorkspaceTabKind) -> Vec<String> {
    order
        .iter()
        .filter(|identity| identity.kind == kind)
        .filter_map(|identity| identity.id.clone())
        .collect()
}

async fn owners_for_documents(
    database: &impl ConnectionTrait,
    ids: &[String],
) -> Result<HashMap<String, String>, CommandError> {
    if ids.is_empty() {
        return Ok(HashMap::new());
    }
    Ok(design_document::Entity::find()
        .select_only()
        .column(design_document::Column::Id)
        .column(design_document::Column::TaskId)
        .filter(design_document::Column::Id.is_in(ids.iter().cloned()))
        .into_tuple::<(String, String)>()
        .all(database)
        .await?
        .into_iter()
        .collect())
}

async fn owners_for_terminals(
    database: &impl ConnectionTrait,
    ids: &[String],
) -> Result<HashMap<String, String>, CommandError> {
    if ids.is_empty() {
        return Ok(HashMap::new());
    }
    Ok(agent_run::Entity::find()
        .select_only()
        .column(agent_run::Column::Id)
        .column(agent_run::Column::IssueId)
        .filter(agent_run::Column::Id.is_in(ids.iter().cloned()))
        .into_tuple::<(String, String)>()
        .all(database)
        .await?
        .into_iter()
        .collect())
}

fn malformed(message: impl Into<String>) -> CommandError {
    CommandError::field("workspace_tab_order", message)
}

fn database_uuid(value: &str) -> Result<String, CommandError> {
    uuid::Uuid::parse_str(value)
        .map(|uuid| uuid.simple().to_string())
        .map_err(|_| CommandError::field("id", "Enter a valid UUID."))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn parses_mixed_identities_and_trims_owned_ids() {
        assert_eq!(
            parse(json!([
                {"kind": "terminal", "id": " run-2 "},
                {"kind": "details"},
                {"kind": "doc", "id": "doc-1"}
            ]))
            .unwrap(),
            vec![
                WorkspaceTabIdentity {
                    kind: WorkspaceTabKind::Terminal,
                    id: Some("run-2".to_owned())
                },
                WorkspaceTabIdentity {
                    kind: WorkspaceTabKind::Details,
                    id: None
                },
                WorkspaceTabIdentity {
                    kind: WorkspaceTabKind::Doc,
                    id: Some("doc-1".to_owned())
                }
            ]
        );
    }

    #[test]
    fn parses_the_idless_changes_identity() {
        assert_eq!(
            parse(json!([{"kind": "changes"}])).unwrap(),
            vec![WorkspaceTabIdentity {
                kind: WorkspaceTabKind::Changes,
                id: None,
            }]
        );
    }

    #[test]
    fn rejects_malformed_and_duplicate_identities() {
        for value in [
            json!({}),
            json!(["details"]),
            json!([{"kind": "details", "id": null}]),
            json!([{"kind": "doc"}]),
            json!([{"kind": "terminal", "id": ""}]),
            json!([{"kind": "other", "id": "x"}]),
            json!([{"kind": "details", "extra": true}]),
            json!([{"kind": "details"}, {"kind": "details"}]),
        ] {
            assert!(parse(value).is_err());
        }
    }
}

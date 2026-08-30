use std::collections::HashSet;

use sea_orm::{ColumnTrait, DatabaseTransaction, EntityTrait, QueryFilter};
use seaolim::{Serializer, WriteSetEntry};

use crate::entities::work_management::issue_type;

/// Rechecks the complete Issue Type set before Seaolim persists any rank.
#[derive(Clone, Copy, Debug, Default)]
pub(super) struct IssueTypeReorderSerializer;

#[sea_orm::prelude::async_trait::async_trait]
impl Serializer<issue_type::ActiveModel> for IssueTypeReorderSerializer {
    async fn validate_list(
        &self,
        transaction: &DatabaseTransaction,
        write_set: &mut [WriteSetEntry<'_, issue_type::ActiveModel>],
    ) -> Result<(), String> {
        let Some(project_id) = write_set
            .first()
            .and_then(WriteSetEntry::old_row)
            .map(|row| row.project_id.clone())
        else {
            return Ok(());
        };
        let mut requested = HashSet::new();
        for (expected_order, entry) in write_set.iter_mut().enumerate() {
            let old_row = entry
                .old_row()
                .ok_or_else(|| "Issue Type reorder may only update existing rows.".to_owned())?;
            if old_row.project_id != project_id || !requested.insert(old_row.id.clone()) {
                return Err("ordered_ids must be exactly this project's rows.".to_owned());
            }
            if entry.row_mut().sort_order.as_ref() != &(expected_order as i32) {
                return Err("Issue Type ordering must be stable and contiguous.".to_owned());
            }
        }
        let stored = issue_type::Entity::find()
            .filter(issue_type::Column::ProjectId.eq(project_id))
            .all(transaction)
            .await
            .map_err(|_| "The Issue Type catalogue could not be checked.".to_owned())?
            .into_iter()
            .map(|row| row.id)
            .collect::<HashSet<_>>();
        if requested != stored {
            return Err("ordered_ids must be exactly this project's rows.".to_owned());
        }
        Ok(())
    }
}

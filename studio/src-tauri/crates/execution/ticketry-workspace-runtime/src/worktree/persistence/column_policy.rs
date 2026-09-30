//! Central Worktree input policy for the generated GraphQL contract.
//!
//! Every derived, Git-owned, or server-owned column is skipped in the
//! generated insert and update inputs. The policy holds even though the entity
//! is registered with `mutation: false`, so a later registration change cannot
//! silently widen the public write surface. The reversible identity codec for
//! the same entity lives with every other column codec in the GraphQL
//! schema slice's query-root context.

use sea_orm::{EntityName, IdenStatic, Iterable};
use seaography::BuilderContext;

use ticketry_entities::worktree;

use super::ownership_manifest::PROTECTED_COLUMNS;

/// Install the Worktree generated-input policy into the shared builder context.
pub fn apply(context: &mut BuilderContext) {
    for name in protected_input_names(context) {
        context.entity_input.insert_skips.push(name.clone());
        context.entity_input.update_skips.push(name);
    }
}

/// `"<TypeName>.<fieldName>"` for every protected column, resolved through the
/// context's own naming functions rather than hardcoded GraphQL spellings.
pub fn protected_input_names(context: &BuilderContext) -> Vec<String> {
    let type_name = (context.entity_object.type_name)(worktree::Entity.table_name());
    worktree::Column::iter()
        .filter(|column| PROTECTED_COLUMNS.contains(&column.as_str()))
        .map(|column| {
            let field = (context.entity_object.column_name)(&type_name, column.as_str());
            format!("{type_name}.{field}")
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn protects_every_manifest_column_and_leaves_the_work_item_writable() {
        let context = BuilderContext::default();
        let names = protected_input_names(&context);

        assert_eq!(names.len(), PROTECTED_COLUMNS.len());
        assert!(names.contains(&"Worktrees.repoRoot".to_owned()));
        assert!(names.contains(&"Worktrees.baseCommit".to_owned()));
        assert!(names.contains(&"Worktrees.ephemeral".to_owned()));
        assert!(!names.contains(&"Worktrees.taskId".to_owned()));
    }
}

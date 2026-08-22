//! Generated create contract for Issue Type.
//!
//! The four generated operations are audited independently:
//!
//! | Operation | Public fields | Identity/scope | Invariants | Decision |
//! | --- | --- | --- | --- | --- |
//! | Create one | `project_id`, `name`, `level`, `color` | one project-owned row | insert lifecycle supplies identity, defaults, ordering, validation, and timestamps | generated |
//! | Create batch | none | no owned caller | no batch contract is required | private |
//! | Update | `name`, `color`, `sort_order`, revisioned start-state change | generated filter is optional and may update many rows | concrete identity and workflow revision are required | private |
//! | Delete | none | generated filter is optional and may delete many rows | reassignment and protected references require a transaction | private |

use std::sync::Arc;

use sea_orm::{EntityName, IdenStatic};
use seaography::{async_graphql::dynamic::TypeRef, Builder, BuilderContext, EntityColumnId};

use crate::{
    entities::work_management::issue_type,
    graphql_foundation::generated_mutations::{register_generated_mutations, GeneratedMutations},
};

const INSERT_SERVER_COLUMNS: &[issue_type::Column] = &[
    issue_type::Column::Id,
    issue_type::Column::SortOrder,
    issue_type::Column::StartStateId,
    issue_type::Column::WorkflowRevision,
    issue_type::Column::IsPathfind,
    issue_type::Column::CreatedAt,
    issue_type::Column::UpdatedAt,
];

const UPDATE_SERVER_COLUMNS: &[issue_type::Column] = &[
    issue_type::Column::Id,
    issue_type::Column::ProjectId,
    issue_type::Column::Level,
    issue_type::Column::StartStateId,
    issue_type::Column::WorkflowRevision,
    issue_type::Column::IsPathfind,
    issue_type::Column::CreatedAt,
    issue_type::Column::UpdatedAt,
];

pub(super) fn apply_input_policy(context: &mut BuilderContext) {
    for column in INSERT_SERVER_COLUMNS {
        context
            .entity_input
            .insert_skips
            .push(input_name(context, *column));
    }
    for column in UPDATE_SERVER_COLUMNS {
        context
            .entity_input
            .update_skips
            .push(input_name(context, *column));
    }

    // Django's contract permits an omitted or null color and stores an empty
    // string. Seaography otherwise makes this non-null database column a
    // required insert field.
    let color = context
        .types
        .column_options
        .entry(EntityColumnId::of::<issue_type::Entity>(
            &issue_type::Column::Color,
        ))
        .or_default();
    color.input_type = Some(TypeRef::named(TypeRef::STRING));
    color.input_conversion = Some(Arc::new(|value| {
        let color = if value.is_null() {
            String::new()
        } else {
            value.string()?.to_owned()
        };
        Ok(sea_orm::Value::String(Some(color)))
    }));
}

pub(super) fn register(mut builder: Builder) -> Builder {
    register_generated_mutations::<issue_type::Entity, issue_type::ActiveModel>(
        &mut builder,
        GeneratedMutations::CREATE_ONE,
    );
    builder
}

fn input_name(context: &BuilderContext, column: issue_type::Column) -> String {
    let type_name = (context.entity_object.type_name)(issue_type::Entity.table_name());
    let field = (context.entity_object.column_name)(&type_name, column.as_str());
    format!("{type_name}.{field}")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn exposes_only_the_audited_create_one_contract() {
        let database = sea_orm::Database::connect("sqlite::memory:").await.unwrap();
        let mut context = BuilderContext::default();
        apply_input_policy(&mut context);
        let context = Box::leak(Box::new(context));
        let builder = crate::entities::work_management::register_entity_modules(Builder::new(
            context, database,
        ));
        let schema = register(builder)
            .schema_builder()
            .finish()
            .expect("build generated Issue Type contract");
        let sdl = schema.sdl();

        assert!(sdl.contains("worktrackerIssuetypeCreateOne"));
        for operation in ["CreateBatch", "Update", "Delete"] {
            assert!(!sdl.contains(&format!("worktrackerIssuetype{operation}(")));
        }

        let insert = sdl
            .split("input WorktrackerIssuetypeInsertInput {")
            .nth(1)
            .expect("Issue Type insert input")
            .split('}')
            .next()
            .unwrap();
        for field in [
            "projectId: String!",
            "name: String!",
            "level: String!",
            "color: String",
        ] {
            assert!(insert.contains(field), "missing {field} from {insert}");
        }
        for field in [
            "id:",
            "sortOrder:",
            "startStateId:",
            "workflowRevision:",
            "isPathfind:",
            "createdAt:",
            "updatedAt:",
        ] {
            assert!(!insert.contains(field), "exposed {field} in {insert}");
        }
    }
}

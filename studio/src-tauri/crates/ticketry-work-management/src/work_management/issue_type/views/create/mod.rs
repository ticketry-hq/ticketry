//! Generated create-one view for Issue Type.
//!
//! The four generated operations remain independently audited:
//!
//! | Operation | Public fields | Identity/scope | Invariants | Decision |
//! | --- | --- | --- | --- | --- |
//! | Create one | `project_id`, `name`, `level`, `color` | one project-owned row | entity lifecycle supplies identity, defaults, ordering, validation, and timestamps | generated |
//! | Create batch | none | no owned caller | no batch contract is required | private |
//! | Update | `name`, `color`, `sort_order`, revisioned start-state change | generated filter is optional and may update many rows | concrete identity and workflow revision are required | private |
//! | Delete | none | generated filter is optional and may delete many rows | reassignment and protected references require a transaction | private |

mod serializer;

use seaography::Builder;
use seaolim::{register_generated_mutations, GeneratedMutations, ViewSerializers};

use ticketry_entities::issue_type;

use serializer::IssueTypeCreateSerializer;

pub(super) fn register(builder: &mut Builder) {
    register_generated_mutations::<issue_type::Entity, issue_type::ActiveModel>(
        builder,
        GeneratedMutations::CREATE_ONE,
        bindings(),
    );
}

fn bindings() -> ViewSerializers {
    ViewSerializers::default().serializer::<issue_type::ActiveModel, _>(IssueTypeCreateSerializer)
}

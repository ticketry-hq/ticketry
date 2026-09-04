mod serializer;

use seaography::{Builder, OperationType};
use seaolim::{
    register_restricted_model_mutation, string_argument, RestrictedMutationField, ViewSerializers,
};

use ticketry_entities::viewer_lease;

pub(super) fn register(builder: &mut Builder) {
    register_restricted_model_mutation::<viewer_lease::Entity, viewer_lease::ActiveModel, _>(
        builder,
        RestrictedMutationField::new("create_viewer_lease", OperationType::Create)
            .argument(string_argument("agent_run_id"))
            .argument(string_argument("viewer_id"))
            .argument(string_argument("transport"))
            .hook_owns_authorization(),
        serializer::CreateViewerLeaseView,
        ViewSerializers::default(),
    );
}

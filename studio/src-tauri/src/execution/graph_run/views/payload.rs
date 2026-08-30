use seaography::{Builder, CustomOutputType};

use crate::{
    entities::execution::graph_run,
    graph_run_service::{DeletedGraphRunResult, GraphRunResult},
    work_management::read_types::StringList,
};

#[derive(Clone, Debug, PartialEq, Eq, CustomOutputType)]
pub(super) struct GraphRunMutationPayload {
    pub graph_run: graph_run::Model,
    pub prepared_child_ids: StringList,
}

#[derive(Clone, Debug, PartialEq, Eq, CustomOutputType)]
pub(super) struct GraphRunDeletePayload {
    pub graph_run: graph_run::Model,
    pub cleared_child_ids: StringList,
}

impl From<GraphRunResult> for GraphRunMutationPayload {
    fn from(result: GraphRunResult) -> Self {
        Self {
            graph_run: result.graph_run,
            prepared_child_ids: StringList(
                result
                    .launched
                    .into_iter()
                    .map(|child| public_id(&child.task_id))
                    .collect(),
            ),
        }
    }
}

impl From<DeletedGraphRunResult> for GraphRunDeletePayload {
    fn from(result: DeletedGraphRunResult) -> Self {
        Self {
            graph_run: result.graph_run,
            cleared_child_ids: StringList(
                result
                    .cleared_task_ids
                    .into_iter()
                    .map(|id| public_id(&id))
                    .collect(),
            ),
        }
    }
}

pub(super) fn register(builder: &mut Builder) {
    builder.register_custom_output::<GraphRunMutationPayload>();
    builder.register_custom_output::<GraphRunDeletePayload>();
}

fn public_id(value: &str) -> String {
    uuid::Uuid::parse_str(value)
        .map(|id| id.hyphenated().to_string())
        .unwrap_or_else(|_| value.to_owned())
}

use seaography::CustomOutputType;
use serde::Serialize;

use crate::runs_persistence::LifecycleAcceptance;

#[derive(Clone, Debug, Eq, PartialEq, Serialize, CustomOutputType)]
pub(super) struct LifecycleAccepted {
    pub accepted: bool,
    pub known_run: bool,
    pub applied: bool,
    pub state: Option<String>,
    pub occurred_at: String,
    pub event_cursor: Option<i64>,
}

impl From<LifecycleAcceptance> for LifecycleAccepted {
    fn from(value: LifecycleAcceptance) -> Self {
        Self {
            accepted: value.accepted,
            known_run: value.known_run,
            applied: value.applied,
            state: value.state,
            occurred_at: value.occurred_at,
            event_cursor: value.event_cursor,
        }
    }
}

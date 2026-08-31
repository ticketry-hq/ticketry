use seaography::async_graphql::{dynamic::ResolverContext, Result};
use seaolim::WritePermit;

use crate::work_management::commands::status_facts::WorkFactRecorder;

pub(super) fn optional_string(ctx: &ResolverContext<'_>, name: &str) -> Result<Option<String>> {
    match ctx.args.get(name) {
        Some(value) if !value.is_null() => Ok(Some(value.string()?.to_owned())),
        _ => Ok(None),
    }
}

pub(super) fn optional_i32(ctx: &ResolverContext<'_>, name: &str) -> Result<Option<i32>> {
    match ctx.args.get(name) {
        Some(value) if !value.is_null() => Ok(Some(value.i64()?.try_into()?)),
        _ => Ok(None),
    }
}

pub(super) fn work_facts(ctx: &ResolverContext<'_>) -> Option<WorkFactRecorder> {
    ctx.data_opt::<WorkFactRecorder>().cloned()
}

pub(super) struct WakeWorkFacts(Option<WorkFactRecorder>);

impl WakeWorkFacts {
    pub(super) fn new(facts: Option<WorkFactRecorder>) -> Self {
        Self(facts)
    }
}

impl WritePermit for WakeWorkFacts {
    fn committed(self: Box<Self>) {
        if let Some(facts) = self.0.as_ref() {
            facts.wake();
        }
    }
}

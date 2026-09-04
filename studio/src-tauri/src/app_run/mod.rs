//! Module-scoped application processes that survive Studio itself.

mod graphql;
mod runtime;
mod service;

pub use runtime::{AppRunLaunch, AppRunObservation, AppRunRuntime, TmuxAppRunRuntime};
pub use service::{AppRunError, AppRunService, AppRunStatus};

pub(crate) fn register_graphql(builder: seaography::Builder) -> seaography::Builder {
    graphql::register(builder)
}

pub fn run_id(module_id: &str) -> String {
    let compact = uuid::Uuid::parse_str(module_id)
        .map(|value| value.simple().to_string())
        .unwrap_or_else(|_| module_id.to_owned());
    format!("app-run-{compact}")
}

pub fn is_app_run_id(value: &str) -> bool {
    value.strip_prefix("app-run-").is_some_and(|module| {
        module.len() == 32 && module.bytes().all(|byte| byte.is_ascii_hexdigit())
    })
}

#[cfg(test)]
mod tests;

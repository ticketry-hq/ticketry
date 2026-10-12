use seaography::async_graphql::{Error, ErrorExtensions};

pub(super) fn error(detail: String) -> Error {
    Error::new(detail).extend_with(|_, e| {
        e.set("code", "sprint_execution_refused");
    })
}

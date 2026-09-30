use async_trait::async_trait;

use crate::CodexAppServerError;

/// The only Codex thread methods Ticketry is allowed to use: read a name and
/// set a name. Nothing here starts, resumes, or forks a thread.
#[async_trait]
pub trait CodexThreadTitles: Send + Sync {
    async fn read_thread_title(
        &self,
        thread_id: &str,
    ) -> Result<Option<String>, CodexAppServerError>;

    /// Rename an existing thread. The default reports the capability missing so
    /// a read-only test double does not have to implement a write.
    async fn set_thread_title(
        &self,
        thread_id: &str,
        name: &str,
    ) -> Result<(), CodexAppServerError> {
        let _ = (thread_id, name);
        Err(CodexAppServerError::unavailable(
            "codex app-server thread rename is unavailable",
        ))
    }
}

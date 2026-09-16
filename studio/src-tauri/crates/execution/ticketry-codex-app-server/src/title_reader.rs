use async_trait::async_trait;

use crate::CodexAppServerError;

#[async_trait]
pub trait CodexThreadTitleReader: Send + Sync {
    async fn read_thread_title(
        &self,
        thread_id: &str,
    ) -> Result<Option<String>, CodexAppServerError>;
}

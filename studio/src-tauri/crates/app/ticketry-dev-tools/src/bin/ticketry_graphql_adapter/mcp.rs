use std::path::Path;

use ticketry_data_directory::DataDirectoryGuard;
use ticketry_mcp::{McpConfiguration, McpRuntime};

pub async fn start(
    data_directory: &Path,
    ownership: &DataDirectoryGuard,
) -> Result<McpRuntime, String> {
    McpRuntime::start(
        McpConfiguration {
            database_path: data_directory.join("state.db"),
            media_root: data_directory.join("media"),
        },
        ownership,
    )
    .await
    .map_err(|error| error.to_string())
}

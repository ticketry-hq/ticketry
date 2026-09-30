use ticketry_data_directory::DataDirectoryGuard;
use ticketry_mcp::{McpConfiguration, McpRuntime};

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let data_directory = ticketry_data_directory::established_data_directory()?;
    let ownership = DataDirectoryGuard::acquire(&data_directory)?;
    let runtime = McpRuntime::start(
        McpConfiguration {
            database_path: data_directory.join("state.db"),
            media_root: data_directory.join("media"),
        },
        &ownership,
    )
    .await?;
    let token = runtime
        .authority()
        .issue(
            "eed04846b08a3b7c801b7a73d4ab8f18",
            ["terminate_current_run".to_owned()],
        )
        .await
        .map_err(|failure| format!("could not issue run token: {}", failure.0))?;
    std::fs::write("/tmp/ticketry-mcp-recovery-token", token)?;
    tokio::signal::ctrl_c().await?;
    Ok(())
}

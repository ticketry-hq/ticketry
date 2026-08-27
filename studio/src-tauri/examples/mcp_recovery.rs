use muxed_studio_lib::work_management::mcp::{McpConfiguration, McpRuntime};
use std::net::{Ipv4Addr, SocketAddr};

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let data_directory = muxed_studio_lib::data_directory::established_data_directory()?;
    let runtime = McpRuntime::start(McpConfiguration {
        address: SocketAddr::from((Ipv4Addr::LOCALHOST, 8123)),
        database_path: data_directory.join("state.db"),
        media_root: data_directory.join("media"),
        ingress_credential: "recovery-only".to_owned(),
    })
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

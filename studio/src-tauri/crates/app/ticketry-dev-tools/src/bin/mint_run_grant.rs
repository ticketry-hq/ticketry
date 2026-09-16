//! Development-only helper: mint a run grant for an existing agent run so a
//! stuck run can end itself through the MCP socket. Never shipped.
use ticketry_runs::RunAuthority;

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let mut arguments = std::env::args().skip(1);
    let agent_run_id = arguments.next().ok_or("agent_run_id required")?;
    let token = arguments.next().unwrap_or_else(|| "dev-grant".to_owned());
    let database =
        sea_orm::Database::connect("sqlite:/Users/karthik/.config/ticketry/state.db").await?;
    let authority = RunAuthority::persistent(
        database,
        std::path::Path::new("/Users/karthik/.config/ticketry"),
    )?;
    let issued = authority
        .grant_for_test(
            &agent_run_id,
            &token,
            ticketry_mcp::allowed_provider_operations(),
            false,
        )
        .await
        .map_err(|failure| failure.0.to_string())?;
    println!("{issued}");
    Ok(())
}

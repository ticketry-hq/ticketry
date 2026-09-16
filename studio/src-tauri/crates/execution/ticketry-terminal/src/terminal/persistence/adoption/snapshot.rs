use super::*;

pub(super) fn rotate_snapshot(
    directory: &Path,
    database: &Path,
) -> Result<PathBuf, TerminalPersistenceError> {
    for generation in (1..SNAPSHOT_GENERATIONS).rev() {
        let older = directory.join(format!("state.db.pre-rust-terminals.{generation}"));
        let newer = directory.join(format!("state.db.pre-rust-terminals.{}", generation + 1));
        if older.exists() {
            fs::rename(older, newer).map_err(io_error)?;
        }
    }
    let path = directory.join("state.db.pre-rust-terminals.1");
    fs::copy(database, &path).map_err(io_error)?;
    Ok(path)
}
pub(super) fn file_sha256(path: &Path) -> Result<String, TerminalPersistenceError> {
    Ok(format!(
        "{:x}",
        Sha256::digest(fs::read(path).map_err(io_error)?)
    ))
}
pub(super) fn write_evidence(
    directory: &Path,
    evidence: &AdoptionEvidence,
) -> Result<(), TerminalPersistenceError> {
    let destination = directory.join("terminal-adoption.json");
    let temporary = directory.join(format!(".terminal-adoption.{}.tmp", uuid::Uuid::new_v4()));
    let mut file = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&temporary)
        .map_err(io_error)?;
    serde_json::to_writer_pretty(&mut file, evidence).map_err(|e| unavailable(e.to_string()))?;
    file.write_all(b"\n").map_err(io_error)?;
    file.sync_all().map_err(io_error)?;
    fs::rename(temporary, destination).map_err(io_error)
}

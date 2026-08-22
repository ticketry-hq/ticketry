//! Who currently owns the data directory, as recorded in the lock file.
//!
//! The record makes a conflicting owner actionable. It is never the source of
//! truth for exclusivity; the kernel advisory lock is.

use rand::{distributions::Alphanumeric, Rng};
use serde::{Deserialize, Serialize};
use std::fs::File;
use std::io::{Read, Seek, SeekFrom, Write};
use std::time::{SystemTime, UNIX_EPOCH};

pub(super) const LOCK_FILE_NAME: &str = ".muxed-desktop-owner.json";

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct OwnerIdentity {
    pub pid: u32,
    pub nonce: String,
    pub acquired_at_millis: u128,
}

pub(super) fn read_owner(file: &mut File) -> Option<OwnerIdentity> {
    file.seek(SeekFrom::Start(0)).ok()?;
    let mut contents = String::new();
    file.read_to_string(&mut contents).ok()?;
    serde_json::from_str(&contents).ok()
}

pub(super) fn write_owner(file: &mut File, owner: &OwnerIdentity) -> std::io::Result<()> {
    let encoded =
        serde_json::to_vec(owner).map_err(|error| std::io::Error::other(error.to_string()))?;
    file.set_len(0)?;
    file.seek(SeekFrom::Start(0))?;
    file.write_all(&encoded)?;
    file.sync_data()
}

pub(super) fn clear_owner(file: &mut File) -> std::io::Result<()> {
    file.set_len(0)?;
    file.seek(SeekFrom::Start(0))?;
    file.sync_data()
}

pub(super) fn now_millis() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
}

pub(super) fn random_nonce() -> String {
    rand::thread_rng()
        .sample_iter(&Alphanumeric)
        .take(24)
        .map(char::from)
        .collect()
}

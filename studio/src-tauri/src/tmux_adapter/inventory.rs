use std::collections::HashMap;

use super::{
    current_runtime_namespace, validate_identifier, InventoryEntry, OwnedSession, SessionRecord,
    TmuxAdapter, TmuxAdapterError,
};

impl TmuxAdapter {
    pub fn inventory(&self) -> Result<Vec<OwnedSession>, TmuxAdapterError> {
        let mut owned = self
            .read_sessions()?
            .into_iter()
            .filter(SessionRecord::is_verified_owned)
            .map(|row| OwnedSession {
                agent_run_id: row.run_id,
                runtime_namespace: row.namespace,
                running: !row.pane_dead,
                exit_code: row.pane_dead.then_some(row.exit_code).flatten(),
            })
            .collect::<Vec<_>>();
        owned.sort_by(|left, right| left.agent_run_id.cmp(&right.agent_run_id));
        Ok(owned)
    }

    /// Return one sanitized classification for every tmux session. Conflict
    /// entries expose only a stable fingerprint, never tmux output or names.
    pub fn classified_inventory(&self) -> Result<Vec<InventoryEntry>, TmuxAdapterError> {
        let current_namespace = current_runtime_namespace()?;
        let records = self.read_sessions()?;
        let duplicate_runs = records
            .iter()
            .filter(|row| validate_identifier(&row.run_id).is_ok())
            .fold(HashMap::<String, usize>::new(), |mut counts, row| {
                *counts.entry(row.run_id.clone()).or_default() += 1;
                counts
            });
        let mut entries = records
            .into_iter()
            .map(|row| {
                if row.is_verified_owned()
                    && duplicate_runs.get(row.run_id.as_str()).copied() == Some(1)
                {
                    InventoryEntry::Owned {
                        legacy_namespace: row.namespace != current_namespace,
                        session: OwnedSession {
                            agent_run_id: row.run_id,
                            runtime_namespace: row.namespace,
                            running: !row.pane_dead,
                            exit_code: row.pane_dead.then_some(row.exit_code).flatten(),
                        },
                    }
                } else {
                    InventoryEntry::Conflict {
                        fingerprint: row.fingerprint(),
                        kind: row.conflict_kind(),
                    }
                }
            })
            .collect::<Vec<_>>();
        entries.sort_by(|left, right| inventory_key(left).cmp(inventory_key(right)));
        Ok(entries)
    }
}

fn inventory_key(entry: &InventoryEntry) -> &str {
    match entry {
        InventoryEntry::Owned { session, .. } => &session.agent_run_id,
        InventoryEntry::Conflict { fingerprint, .. } => fingerprint,
    }
}

//! One `list-sessions` reading, kept so a whole reconciliation pass is judged
//! against a single instant instead of spawning one tmux process per row.

use super::{
    observe_records, InventoryEntry, RuntimeIdentity, RuntimeObservation, SessionRecord,
    TmuxAdapter, TmuxAdapterError,
};

pub(crate) struct TmuxSnapshot {
    records: Vec<SessionRecord>,
}

impl TmuxAdapter {
    pub(crate) fn snapshot(&self) -> Result<TmuxSnapshot, TmuxAdapterError> {
        Ok(TmuxSnapshot {
            records: self.read_sessions()?,
        })
    }
}

impl TmuxSnapshot {
    /// The same judgement [`TmuxAdapter::observe`] makes, without a round trip.
    pub(crate) fn observe(&self, identity: &RuntimeIdentity) -> RuntimeObservation {
        observe_records(identity, &self.records)
    }

    pub(crate) fn classified_inventory(&self) -> Result<Vec<InventoryEntry>, TmuxAdapterError> {
        super::inventory::classify(&self.records)
    }
}

#[cfg(test)]
impl TmuxSnapshot {
    pub(crate) fn from_listing(lines: &[&str]) -> Self {
        Self {
            records: lines
                .iter()
                .map(|line| SessionRecord::parse(line).expect("parse a listing line"))
                .collect(),
        }
    }
}

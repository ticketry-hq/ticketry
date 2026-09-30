use super::{
    session_name, validate_identifier, InventoryConflictKind, RuntimeIdentity, RuntimeObservation,
    TmuxAdapterError, OWNER_VALUE,
};
use sha2::{Digest, Sha256};

pub(super) struct SessionRecord {
    pub name: String,
    pub owner: String,
    pub run_id: String,
    pub namespace: String,
    pub pane_count: usize,
    pub pane_dead: bool,
    pub exit_code: Option<i32>,
}
impl SessionRecord {
    pub(super) fn parse(line: &str) -> Result<Self, TmuxAdapterError> {
        let f = line.split('\t').collect::<Vec<_>>();
        if f.len() != 7 {
            return Err(TmuxAdapterError::Unavailable(
                "malformed inventory record".into(),
            ));
        }
        let pane_count = f[4]
            .parse()
            .map_err(|_| TmuxAdapterError::Unavailable("invalid pane count".into()))?;
        let pane_dead = match f[5] {
            "0" => false,
            "1" => true,
            _ => return Err(TmuxAdapterError::Unavailable("invalid pane state".into())),
        };
        let exit_code = if f[6].is_empty() {
            None
        } else {
            Some(
                f[6].parse()
                    .map_err(|_| TmuxAdapterError::Unavailable("invalid exit code".into()))?,
            )
        };
        Ok(Self {
            name: f[0].into(),
            owner: f[1].into(),
            run_id: f[2].into(),
            namespace: f[3].into(),
            pane_count,
            pane_dead,
            exit_code,
        })
    }
    pub(super) fn is_verified_owned(&self) -> bool {
        self.owner == OWNER_VALUE
            && validate_identifier(&self.namespace).is_ok()
            && validate_identifier(&self.run_id).is_ok()
            && self.name == session_name(&self.run_id)
            && self.pane_count == 1
    }

    pub(super) fn conflict_kind(&self) -> InventoryConflictKind {
        if self.owner == OWNER_VALUE {
            InventoryConflictKind::Ambiguous
        } else {
            InventoryConflictKind::Foreign
        }
    }

    pub(super) fn fingerprint(&self) -> String {
        let digest =
            Sha256::digest(format!("ticketry-tmux-inventory-v1\0{}", self.name).as_bytes());
        format!("{digest:x}")[..16].to_owned()
    }
}

pub(super) fn observe_records(
    identity: &RuntimeIdentity,
    sessions: &[SessionRecord],
) -> RuntimeObservation {
    let expected = session_name(identity.agent_run_id());
    let exact = sessions
        .iter()
        .filter(|row| row.name == expected)
        .collect::<Vec<_>>();
    let same_run = sessions
        .iter()
        .filter(|row| row.run_id == identity.agent_run_id())
        .count();
    if exact.is_empty() {
        return if same_run == 0 {
            RuntimeObservation::Missing
        } else {
            RuntimeObservation::Ambiguous
        };
    }
    if exact.len() != 1 {
        return RuntimeObservation::Ambiguous;
    }
    let row = exact[0];
    if row.owner != OWNER_VALUE
        || row.run_id != identity.agent_run_id()
        || row.namespace != identity.runtime_namespace()
    {
        return RuntimeObservation::Foreign;
    }
    if same_run != 1 || row.pane_count != 1 {
        return RuntimeObservation::Ambiguous;
    }
    if row.pane_dead {
        RuntimeObservation::Exited {
            exit_code: row.exit_code,
        }
    } else {
        RuntimeObservation::Running
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn inventory_classification_accepts_legacy_namespaces_without_renaming() {
        let record =
            SessionRecord::parse("pt-run-1\tticketry-v1\trun-1\tlegacy-runtime\t1\t0\t").unwrap();
        assert!(record.is_verified_owned());
        assert_eq!(record.namespace, "legacy-runtime");
        assert_eq!(record.name, "pt-run-1");
    }

    #[test]
    fn conflict_fingerprints_are_stable_and_hide_raw_session_identity() {
        let record = SessionRecord::parse(
            "pt-sensitive-name\tsomeone-else\tsensitive-name\tlegacy-runtime\t1\t0\t",
        )
        .unwrap();
        assert_eq!(record.conflict_kind(), InventoryConflictKind::Foreign);
        assert_eq!(record.fingerprint(), record.fingerprint());
        assert!(!record.fingerprint().contains("sensitive"));
    }
}

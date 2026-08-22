use super::TerminalCleanupError;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum CleanupCheckpoint {
    Preparation,
    Claim,
    Inspect,
    Kill,
    TerminalTombstone,
    RunFact,
    StatusAppend,
    Settlement,
    Response,
}

pub trait CleanupCheckpoints: Send + Sync {
    fn reached(&self, checkpoint: CleanupCheckpoint) -> Result<(), TerminalCleanupError>;
}

pub(crate) struct NoCleanupCheckpoints;

impl CleanupCheckpoints for NoCleanupCheckpoints {
    fn reached(&self, _: CleanupCheckpoint) -> Result<(), TerminalCleanupError> {
        Ok(())
    }
}

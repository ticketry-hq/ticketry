#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum ExecutionPersistenceErrorCode {
    AdoptionUnavailable,
    IncompatibleSchema,
    InvalidHistory,
}

#[derive(Debug)]
pub struct ExecutionPersistenceError {
    code: ExecutionPersistenceErrorCode,
    message: String,
}

impl ExecutionPersistenceError {
    pub fn new(code: ExecutionPersistenceErrorCode, message: impl Into<String>) -> Self {
        Self {
            code,
            message: message.into(),
        }
    }

    pub fn code(&self) -> ExecutionPersistenceErrorCode {
        self.code
    }
}

impl std::fmt::Display for ExecutionPersistenceError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(&self.message)
    }
}

impl std::error::Error for ExecutionPersistenceError {}

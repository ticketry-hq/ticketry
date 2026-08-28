use sea_orm::DbErr;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum GraphFactsErrorCode {
    TaskNotFound,
    RootArchived,
    GraphEmpty,
    RootUnscoped,
    Unauthorized,
    Storage,
}

impl GraphFactsErrorCode {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::TaskNotFound => "task_not_found",
            Self::RootArchived => "graph_root_archived",
            Self::GraphEmpty => "graph_empty",
            Self::RootUnscoped => "module_id_required",
            Self::Unauthorized => "graph_unauthorized",
            Self::Storage => "graph_storage_failure",
        }
    }
}

#[derive(Debug)]
pub struct GraphFactsError {
    code: GraphFactsErrorCode,
    message: &'static str,
    source: Option<DbErr>,
}

impl GraphFactsError {
    pub(crate) const fn new(code: GraphFactsErrorCode, message: &'static str) -> Self {
        Self {
            code,
            message,
            source: None,
        }
    }

    pub const fn code(&self) -> GraphFactsErrorCode {
        self.code
    }
}

impl std::fmt::Display for GraphFactsError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(self.message)
    }
}

impl std::error::Error for GraphFactsError {
    fn source(&self) -> Option<&(dyn std::error::Error + 'static)> {
        self.source
            .as_ref()
            .map(|source| source as &(dyn std::error::Error + 'static))
    }
}

impl From<DbErr> for GraphFactsError {
    fn from(source: DbErr) -> Self {
        Self {
            code: GraphFactsErrorCode::Storage,
            message: "Dependency graph facts could not be read.",
            source: Some(source),
        }
    }
}

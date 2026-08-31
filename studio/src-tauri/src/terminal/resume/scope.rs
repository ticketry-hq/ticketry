use sea_orm::{sea_query::Expr, ColumnTrait, Condition, ExprTrait};

use crate::launch::terminal_session::{CreateTerminalSession, TerminalLaunchKind};
use ticketry_entities::terminals::session;

use super::validation::ResumeValidationError;

#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) enum ResumeScope {
    Task {
        task_id: String,
    },
    Scratch {
        project_id: String,
        module_id: String,
    },
}

impl ResumeScope {
    pub(crate) fn from_query(
        task_id: Option<String>,
        project_id: Option<String>,
        module_id: Option<String>,
    ) -> Result<Self, ResumeValidationError> {
        match (nonempty(task_id), nonempty(project_id), nonempty(module_id)) {
            (Some(task_id), None, None) => Ok(Self::Task {
                task_id: compact(&task_id),
            }),
            (None, Some(project_id), Some(module_id)) => Ok(Self::Scratch {
                project_id: compact(&project_id),
                module_id: compact(&module_id),
            }),
            _ => Err(ResumeValidationError::wrong_scope()),
        }
    }

    pub(crate) fn from_create(request: &CreateTerminalSession) -> Self {
        match request.kind {
            TerminalLaunchKind::Task | TerminalLaunchKind::Automation => Self::Task {
                task_id: compact(&request.issue_id),
            },
            TerminalLaunchKind::Planning
            | TerminalLaunchKind::Instant
            | TerminalLaunchKind::Shell => Self::Scratch {
                project_id: compact(&request.project_id),
                module_id: compact(&request.module_id),
            },
            TerminalLaunchKind::DocumentChat => Self::Task {
                task_id: compact(&request.issue_id),
            },
        }
    }

    pub(crate) fn session_condition(&self) -> Condition {
        match self {
            Self::Task { task_id } => Condition::all()
                .add(compact_session_column(session::Column::TaskId).eq(task_id.clone()))
                .add(session::Column::Scope.eq("task")),
            Self::Scratch {
                project_id,
                module_id,
            } => Condition::all()
                .add(compact_session_column(session::Column::ProjectId).eq(project_id.clone()))
                .add(compact_session_column(session::Column::ModuleId).eq(module_id.clone()))
                .add(
                    compact_session_column(session::Column::TaskId)
                        .eq(compact(crate::documents::SCRATCH_TASK_ID)),
                )
                .add(session::Column::Scope.is_in(["plan", "instant"])),
        }
    }

    pub(crate) fn matches_create(
        &self,
        request: &CreateTerminalSession,
        row: &session::Model,
    ) -> bool {
        let project = compact(&request.project_id);
        let module = compact(&request.module_id);
        match self {
            Self::Task { task_id } => {
                // A Work Item can move between modules after a conversation
                // ends. The task and project remain the resume boundary; the
                // session's historical module placement does not.
                matches!(
                    request.kind,
                    TerminalLaunchKind::Task | TerminalLaunchKind::Automation
                ) && row.scope == "task"
                    && compact(&row.task_id) == *task_id
                    && compact(&row.project_id) == project
            }
            Self::Scratch {
                project_id,
                module_id,
            } => {
                matches!(
                    request.kind,
                    TerminalLaunchKind::Planning | TerminalLaunchKind::Instant
                ) && row.scope == request.kind.scope()
                    && compact(&row.project_id) == *project_id
                    && compact(&row.module_id) == *module_id
                    && project == *project_id
                    && module == *module_id
            }
        }
    }
}

pub(crate) fn compact_session_column(column: session::Column) -> Expr {
    Expr::cust_with_expr("replace(?, '-', '')", Expr::col(column))
}

pub(crate) fn compact(value: &str) -> String {
    uuid::Uuid::parse_str(value)
        .map(|value| value.simple().to_string())
        .unwrap_or_else(|_| value.to_owned())
}

fn nonempty(value: Option<String>) -> Option<String> {
    value.filter(|value| !value.trim().is_empty())
}

use std::path::{Path, PathBuf};

use sea_orm::{ColumnTrait, EntityTrait, QueryFilter};

use crate::worktree::status::{self, repository::RepositoryResolution};
use ticketry_entities::worktree;

use super::{
    command_git, module_baseline, repository, RepositoryCommandResult, WorktreeChangesError,
    WorktreeChangesService,
};

enum CommandKind<'a> {
    Commit(&'a str),
    Push,
}

impl WorktreeChangesService {
    pub async fn commit_task(
        &self,
        task_id: &str,
        operation_id: &str,
        message: &str,
    ) -> Result<RepositoryCommandResult, WorktreeChangesError> {
        validate_operation(operation_id)?;
        validate_message(message)?;
        let owner = status::owner::resolve(self.status().work_items(), task_id).await?;
        let row = worktree::Entity::find()
            .filter(worktree::Column::TaskId.eq(owner.top_level_row_id()))
            .one(self.status().work_items())
            .await?
            .ok_or_else(WorktreeChangesError::not_found)?;
        let (repository_root, checkout) = repository::recorded_paths(&row.repo_root, &row.path)?;
        self.run_command(
            operation_id,
            &repository_root,
            &checkout,
            Some(&row.base_commit),
            false,
            CommandKind::Commit(message.trim()),
        )
        .await
    }

    pub async fn push_task(
        &self,
        task_id: &str,
        operation_id: &str,
    ) -> Result<RepositoryCommandResult, WorktreeChangesError> {
        validate_operation(operation_id)?;
        let owner = status::owner::resolve(self.status().work_items(), task_id).await?;
        let row = worktree::Entity::find()
            .filter(worktree::Column::TaskId.eq(owner.top_level_row_id()))
            .one(self.status().work_items())
            .await?
            .ok_or_else(WorktreeChangesError::not_found)?;
        let (repository_root, checkout) = repository::recorded_paths(&row.repo_root, &row.path)?;
        self.run_command(
            operation_id,
            &repository_root,
            &checkout,
            Some(&row.base_commit),
            false,
            CommandKind::Push,
        )
        .await
    }

    pub async fn commit_module(
        &self,
        module_id: &str,
        operation_id: &str,
        message: &str,
    ) -> Result<RepositoryCommandResult, WorktreeChangesError> {
        validate_operation(operation_id)?;
        validate_message(message)?;
        let repository = self.module_repository(module_id).await?;
        self.run_command(
            operation_id,
            &repository,
            &repository,
            None,
            true,
            CommandKind::Commit(message.trim()),
        )
        .await
    }

    pub async fn push_module(
        &self,
        module_id: &str,
        operation_id: &str,
    ) -> Result<RepositoryCommandResult, WorktreeChangesError> {
        validate_operation(operation_id)?;
        let repository = self.module_repository(module_id).await?;
        self.run_command(
            operation_id,
            &repository,
            &repository,
            None,
            true,
            CommandKind::Push,
        )
        .await
    }

    pub(super) async fn module_repository(
        &self,
        module_id: &str,
    ) -> Result<PathBuf, WorktreeChangesError> {
        match status::repository::resolve(
            self.status().work_items(),
            self.status().git(),
            Some(module_id),
        )
        .await?
        {
            RepositoryResolution::Repository(repository) => Ok(repository),
            RepositoryResolution::NoRepository(_) => {
                Err(WorktreeChangesError::repository_missing())
            }
        }
    }

    async fn run_command(
        &self,
        operation_id: &str,
        repository_root: &Path,
        checkout: &Path,
        fallback_base: Option<&str>,
        module_fallback: bool,
        command: CommandKind<'_>,
    ) -> Result<RepositoryCommandResult, WorktreeChangesError> {
        let _guard = self
            .status()
            .repository_locks()
            .acquire(repository_root)
            .await;
        if repository_root != checkout {
            repository::validate_membership(self.status().git(), repository_root, checkout).await?;
        }
        let module_base = if module_fallback {
            module_baseline::resolve(self.status().git(), checkout)
                .await?
                .map(|baseline| baseline.commit)
        } else {
            None
        };
        let fallback_base = fallback_base.or(module_base.as_deref());
        let before = command_git::facts(self.status().git(), checkout, fallback_base).await?;
        let excluded = matches!(command, CommandKind::Push) && before.dirty;
        match command {
            CommandKind::Commit(message) => {
                if !before.dirty {
                    return Err(WorktreeChangesError::nothing_to_commit());
                }
                command_git::commit(self.status().git(), checkout, message).await?;
            }
            CommandKind::Push => {
                if before.unpushed_count == 0 {
                    return Err(WorktreeChangesError::nothing_to_push());
                }
                command_git::push(self.status().git(), checkout, &before).await?;
            }
        }
        let after = command_git::facts(self.status().git(), checkout, fallback_base).await?;
        Ok(RepositoryCommandResult {
            operation_id: operation_id.to_owned(),
            head_commit: after.head_commit,
            dirty: after.dirty,
            unpushed_count: after.unpushed_count,
            uncommitted_work_excluded: excluded,
        })
    }
}

pub(super) fn validate_operation(operation_id: &str) -> Result<(), WorktreeChangesError> {
    if operation_id.trim().is_empty() || operation_id.len() > 128 {
        Err(WorktreeChangesError::invalid_operation())
    } else {
        Ok(())
    }
}

fn validate_message(message: &str) -> Result<(), WorktreeChangesError> {
    let message = message.trim();
    if message.is_empty() || message.len() > 10_000 {
        Err(WorktreeChangesError::invalid_commit_message())
    } else {
        Ok(())
    }
}

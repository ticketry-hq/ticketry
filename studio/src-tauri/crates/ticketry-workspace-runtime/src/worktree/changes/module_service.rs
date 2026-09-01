use sea_orm::{ColumnTrait, EntityTrait, QueryFilter, QueryOrder, QuerySelect};

use crate::worktree::status::repository::RepositoryResolution;
use crate::worktree::status::{self};
use ticketry_entities::worktree;
use ticketry_entities::{issue, project};

use super::module_view::{
    CurrentWorktreeView, ModuleCheckoutChangesView, ModuleVersionControlView,
};
use super::{
    git, module_baseline, repository, PullRequestStatusView, WorktreeChangesError,
    WorktreeChangesService,
};

const MAX_CURRENT_TASK_WORKTREES: u64 = 100;

impl WorktreeChangesService {
    pub async fn module_version_control(
        &self,
        module_id: &str,
    ) -> Result<ModuleVersionControlView, WorktreeChangesError> {
        let (module, project) = issue::Entity::find_by_id(module_id)
            .find_also_related(project::Entity)
            .one(self.status().work_items())
            .await?
            .filter(|(module, _)| module.r#type == "module")
            .ok_or_else(WorktreeChangesError::module_not_found)?;
        let project = project.ok_or_else(WorktreeChangesError::module_not_found)?;
        let checkout = self.module_checkout(&module.id).await?;
        let mut worktrees = vec![module_row(&checkout)];

        let mut rows = worktree::Entity::find()
            .find_also_related(issue::Entity)
            .filter(worktree::Column::ModuleId.eq(module_id))
            .filter(worktree::Column::Status.is_in(["active", "conflict"]))
            .order_by_asc(worktree::Column::TicketSeq)
            .limit(MAX_CURRENT_TASK_WORKTREES + 1)
            .all(self.status().work_items())
            .await?;
        let worktrees_truncated = rows.len() as u64 > MAX_CURRENT_TASK_WORKTREES;
        rows.truncate(MAX_CURRENT_TASK_WORKTREES as usize);
        for (row, task) in rows {
            let Some(task) = task else { continue };
            let live = self.status().status(&row.task_id).await;
            let pull_request = self.task_pull_request_status(&row).await;
            worktrees.push(task_row(&project.slug, row, task, live, pull_request));
        }

        Ok(ModuleVersionControlView {
            module_id: module.id,
            checkout,
            worktrees,
            worktrees_truncated,
        })
    }

    async fn task_pull_request_status(&self, row: &worktree::Model) -> PullRequestStatusView {
        let Some(url) = row.pull_request_url.as_ref() else {
            return PullRequestStatusView::none();
        };
        let lock_key = std::path::PathBuf::from(&row.repo_root);
        let provider_checkout = repository::recorded_repository(&row.repo_root)
            .or_else(|_| std::env::current_dir().map_err(|_| WorktreeChangesError::invalid_path()));
        let Ok(provider_checkout) = provider_checkout else {
            return PullRequestStatusView::unavailable(url.clone());
        };
        let _guard = self.status().repository_locks().acquire(&lock_key).await;
        let Ok(Some(row)) = worktree::Entity::find_by_id(&row.id)
            .one(self.status().work_items())
            .await
        else {
            return PullRequestStatusView::unavailable(url.clone());
        };
        let Some(url) = row.pull_request_url.as_ref() else {
            return PullRequestStatusView::none();
        };
        let provider = match self.github().pull_request(&provider_checkout, url).await {
            Ok(provider) => provider,
            Err(_) => return PullRequestStatusView::unavailable(url.clone()),
        };
        let checkout_head = match repository::recorded_paths(&row.repo_root, &row.path) {
            Ok((_, checkout))
                if repository::validate_membership(
                    self.status().git(),
                    &provider_checkout,
                    &checkout,
                )
                .await
                .is_ok() =>
            {
                super::command_git::facts(self.status().git(), &checkout, Some(&row.base_commit))
                    .await
                    .ok()
                    .map(|facts| facts.head_commit)
            }
            _ => None,
        };
        let checkout_head = checkout_head.unwrap_or_else(|| provider.head_commit.clone());
        PullRequestStatusView::available(url.clone(), provider, &row.base_branch, &checkout_head)
    }

    async fn module_checkout(
        &self,
        module_id: &str,
    ) -> Result<ModuleCheckoutChangesView, WorktreeChangesError> {
        let repository = match status::repository::resolve(
            self.status().work_items(),
            self.status().git(),
            Some(module_id),
        )
        .await?
        {
            RepositoryResolution::Repository(repository) => repository,
            RepositoryResolution::NoRepository(reason) => {
                return Ok(ModuleCheckoutChangesView::unavailable(reason));
            }
        };
        let _guard = self.status().repository_locks().acquire(&repository).await;
        let Some(baseline) = module_baseline::resolve(self.status().git(), &repository).await?
        else {
            return Ok(ModuleCheckoutChangesView::unavailable(
                "The module checkout has no commit to compare.",
            ));
        };
        let status = self
            .status()
            .git()
            .run(
                &["status", "--porcelain=v1", "-z", "--untracked-files=all"],
                &repository,
            )
            .await?;
        if !status.succeeded {
            return Ok(ModuleCheckoutChangesView::unavailable(
                "Git could not read the module checkout.",
            ));
        }
        let dirty = !status.stdout.is_empty();
        let pull_request_target =
            module_baseline::pull_request_target(self.status().git(), &repository).await?;
        let committed_count = match &pull_request_target {
            Some(target) => {
                super::command_git::committed_count(
                    self.status().git(),
                    &repository,
                    &target.base_reference,
                )
                .await?
            }
            None => 0,
        };
        let changes = git::cumulative(self.status().git(), &repository, &baseline.commit).await?;
        Ok(ModuleCheckoutChangesView {
            available: true,
            reason: None,
            branch: Some(baseline.branch),
            default_branch: pull_request_target
                .as_ref()
                .map(|target| target.base_branch.clone()),
            committed_count,
            pull_request_creation_eligible: pull_request_target.is_some() && committed_count > 0,
            baseline: Some(baseline.comparison),
            baseline_kind: Some(baseline.kind.to_owned()),
            clean: Some(!dirty),
            dirty: Some(dirty),
            unpushed_count: Some(baseline.unpushed_count),
            truncated: changes.truncated,
            files: changes.files,
        })
    }
}

fn module_row(checkout: &ModuleCheckoutChangesView) -> CurrentWorktreeView {
    CurrentWorktreeView {
        kind: "module".to_owned(),
        task_id: None,
        task_key: None,
        task_name: None,
        branch: checkout.branch.clone(),
        available: checkout.available,
        clean: checkout.clean,
        dirty: checkout.dirty,
        unpushed_count: checkout.unpushed_count,
        pull_request_state: "none".to_owned(),
        pull_request: PullRequestStatusView::none(),
        reason: checkout.reason.clone(),
    }
}

fn task_row(
    project_slug: &str,
    row: worktree::Model,
    task: issue::Model,
    live: Result<status::WorktreeStatusView, status::WorktreeStatusError>,
    pull_request: PullRequestStatusView,
) -> CurrentWorktreeView {
    match live {
        Ok(live) => {
            let available =
                live.kind == status::KIND_WORKTREE && live.checkout_present == Some(true);
            CurrentWorktreeView {
                kind: "task".to_owned(),
                task_id: Some(task.id),
                task_key: Some(format!("{project_slug}-{}", task.sequence_id)),
                task_name: Some(task.name),
                branch: live.branch.or(Some(row.branch)),
                available,
                clean: available.then_some(live.clean).flatten(),
                dirty: available.then_some(live.dirty).flatten(),
                unpushed_count: available.then_some(live.ahead).flatten(),
                pull_request_state: pull_request.state.clone(),
                pull_request,
                reason: (!available)
                    .then(|| "This task worktree checkout is unavailable.".to_owned()),
            }
        }
        Err(error) => CurrentWorktreeView {
            kind: "task".to_owned(),
            task_id: Some(task.id),
            task_key: Some(format!("{project_slug}-{}", task.sequence_id)),
            task_name: Some(task.name),
            branch: Some(row.branch),
            available: false,
            clean: None,
            dirty: None,
            unpushed_count: None,
            pull_request_state: pull_request.state.clone(),
            pull_request,
            reason: Some(error.to_string()),
        },
    }
}

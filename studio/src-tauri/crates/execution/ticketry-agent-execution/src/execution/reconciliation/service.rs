use std::collections::BTreeSet;

use sea_orm::{ColumnTrait, DatabaseConnection, EntityTrait, QueryFilter, QueryOrder, QuerySelect};

use crate::execution::graph::{relevant_armed_roots, GraphAccess};
use crate::graph_run_service::GraphRunService;
use ticketry_entities::{
    status_event, transition_occurrence, {graph_run, launch_claim},
};
use ticketry_terminal::TerminalLaunchService;
use ticketry_work_management::launch_policy::{self, LaunchPolicyResolver};

use super::{ExecutionReconciliationReport, RootReconciliation};

pub const DEFAULT_BATCH_SIZE: u64 = 128;

#[derive(Clone)]
pub struct ExecutionReconciliationService {
    database: DatabaseConnection,
    policy: LaunchPolicyResolver,
    terminal_launch: TerminalLaunchService,
    graph_runs: GraphRunService,
}

impl ExecutionReconciliationService {
    pub fn new(
        database: DatabaseConnection,
        policy: LaunchPolicyResolver,
        terminal_launch: TerminalLaunchService,
    ) -> Self {
        Self {
            graph_runs: GraphRunService::new(
                database.clone(),
                policy.clone(),
                terminal_launch.clone(),
            ),
            database,
            policy,
            terminal_launch,
        }
    }

    /// Settle durable automation decisions before campaigns are considered.
    pub async fn reconcile_automation(&self, limit: u64) -> ExecutionReconciliationReport {
        let mut report = ExecutionReconciliationReport::default();
        if let Err(error) =
            launch_policy::prepare_pending_auto_starts(&self.database, &self.policy, limit).await
        {
            report.automation_failures.push(error.to_string());
        }
        if let Err(error) =
            launch_policy::prepare_pending_retries(&self.database, &self.policy, limit).await
        {
            report.automation_failures.push(error.to_string());
        }
        match launch_policy::pending(&self.database, limit).await {
            Ok(decisions) => {
                report.automation_decisions = decisions.len();
                for decision in decisions {
                    if let Err(error) = crate::execution::launch_delivery::execute(
                        &self.database,
                        &self.terminal_launch,
                        &decision,
                    )
                    .await
                    {
                        report
                            .automation_failures
                            .push(format!("decision {}: {error}", decision.decision_id));
                    }
                }
            }
            Err(error) => report.automation_failures.push(error.to_string()),
        }
        report
    }

    pub async fn reconcile_work_item(
        &self,
        work_item_id: &str,
        project_id: &str,
    ) -> ExecutionReconciliationReport {
        let roots = match relevant_armed_roots(
            &self.database,
            work_item_id,
            &GraphAccess::project(project_id),
        )
        .await
        {
            Ok(roots) => roots,
            Err(error) => {
                return diagnostic(format!(
                    "work-item event {work_item_id} could not resolve armed roots: {error}"
                ))
            }
        };
        self.reconcile_roots(roots).await
    }

    pub async fn reconcile_agent_run(&self, agent_run_id: &str) -> ExecutionReconciliationReport {
        let claims = match launch_claim::Entity::find()
            .filter(launch_claim::Column::AgentRunId.eq(compact(agent_run_id)))
            .all(&self.database)
            .await
        {
            Ok(claims) => claims,
            Err(error) => {
                return diagnostic(format!(
                    "Run event {agent_run_id} could not read campaign claims: {error}"
                ))
            }
        };
        let root_ids = claims
            .into_iter()
            .map(|claim| claim.root_id)
            .collect::<Vec<_>>();
        let serial_roots = if root_ids.is_empty() {
            Vec::new()
        } else {
            match graph_run::Entity::find()
                .filter(graph_run::Column::RootId.is_in(root_ids))
                .filter(graph_run::Column::ExecutionMode.eq("serial"))
                .all(&self.database)
                .await
            {
                Ok(graphs) => graphs.into_iter().map(|graph| graph.root_id).collect(),
                Err(error) => {
                    return diagnostic(format!(
                        "Run event {agent_run_id} could not read serial campaigns: {error}"
                    ))
                }
            }
        };
        self.reconcile_roots(serial_roots).await
    }

    /// Consume recent durable Work Item and Runs facts. Re-reading rows is safe:
    /// handlers derive current state and campaign claims make launch idempotent.
    pub async fn reconcile_recent_events(&self, limit: u64) -> ExecutionReconciliationReport {
        let mut roots = BTreeSet::new();
        let mut report = ExecutionReconciliationReport::default();
        match transition_occurrence::Entity::find()
            .order_by_desc(transition_occurrence::Column::CommittedAt)
            .order_by_desc(transition_occurrence::Column::OccurrenceId)
            .limit(limit)
            .all(&self.database)
            .await
        {
            Ok(occurrences) => {
                for occurrence in occurrences {
                    match relevant_armed_roots(
                        &self.database,
                        &occurrence.issue_id,
                        &GraphAccess::project(&occurrence.project_id),
                    )
                    .await
                    {
                        Ok(relevant) => roots.extend(relevant),
                        Err(error) => report.diagnostics.push(format!(
                            "transition occurrence {} could not resolve armed roots: {error}",
                            occurrence.occurrence_id
                        )),
                    }
                }
            }
            Err(error) => report
                .diagnostics
                .push(format!("transition occurrences could not be read: {error}")),
        }
        match status_event::Entity::find()
            .filter(status_event::Column::AgentRunId.is_not_null())
            .order_by_desc(status_event::Column::Cursor)
            .limit(limit)
            .all(&self.database)
            .await
        {
            Ok(events) => {
                for event in events {
                    if let Some(agent_run_id) = event.agent_run_id {
                        let event_report = self.reconcile_agent_run(&agent_run_id).await;
                        report.diagnostics.extend(event_report.diagnostics);
                        roots.extend(event_report.roots.into_iter().map(|root| root.root_id));
                    }
                }
            }
            Err(error) => report
                .diagnostics
                .push(format!("Runs status events could not be read: {error}")),
        }
        report.merge(self.reconcile_roots(roots).await);
        report
    }

    /// Read one deterministic page. Callers retain `next_root_id` between
    /// periodic passes and loop pages during startup.
    pub async fn reconcile_armed_batch(
        &self,
        after_root_id: Option<&str>,
        limit: u64,
    ) -> ExecutionReconciliationReport {
        let mut query = graph_run::Entity::find().order_by_asc(graph_run::Column::RootId);
        if let Some(after) = after_root_id {
            query = query.filter(graph_run::Column::RootId.gt(compact(after)));
        }
        let roots = match query.limit(limit).all(&self.database).await {
            Ok(graphs) => graphs
                .into_iter()
                .map(|graph| graph.root_id)
                .collect::<Vec<_>>(),
            Err(error) => return diagnostic(format!("armed roots could not be read: {error}")),
        };
        let mut report = self.reconcile_roots(roots).await;
        report.next_root_id = (report.roots.len() == limit as usize)
            .then(|| report.roots.last().map(|root| root.root_id.clone()))
            .flatten();
        report
    }

    async fn reconcile_roots(
        &self,
        roots: impl IntoIterator<Item = String>,
    ) -> ExecutionReconciliationReport {
        let mut roots = roots
            .into_iter()
            .map(|root| compact(&root))
            .collect::<Vec<_>>();
        roots.sort();
        roots.dedup();
        let mut report = ExecutionReconciliationReport::default();
        for root_id in roots {
            match self.graph_runs.advance(&root_id).await {
                Ok(result) => report.roots.push(RootReconciliation {
                    root_id: result.root_id,
                    launched_task_ids: result
                        .launched
                        .into_iter()
                        .map(|child| child.task_id)
                        .collect(),
                    terminal_reconciliation_requested: result.terminal_reconciliation_requested,
                    error: None,
                }),
                Err(error) => report.roots.push(RootReconciliation {
                    root_id,
                    launched_task_ids: Vec::new(),
                    terminal_reconciliation_requested: false,
                    error: Some(format!("{}: {error}", error.code_str())),
                }),
            }
        }
        report
    }
}

fn diagnostic(message: String) -> ExecutionReconciliationReport {
    ExecutionReconciliationReport {
        diagnostics: vec![message],
        ..ExecutionReconciliationReport::default()
    }
}

fn compact(value: &str) -> String {
    uuid::Uuid::parse_str(value)
        .map(|value| value.simple().to_string())
        .unwrap_or_else(|_| value.to_owned())
}

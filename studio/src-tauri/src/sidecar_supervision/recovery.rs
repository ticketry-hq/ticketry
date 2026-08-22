//! Noticing a sidecar has died and deciding whether to restart it.
//!
//! The restart budget is restored only after a stretch of continuous health, so
//! a crash loop cannot spend it indefinitely.

use std::sync::atomic::Ordering;
use std::time::{Duration, Instant};

use super::error::{process_error, FailureKind, SupervisorError};
use super::events::SupervisorEvent;
use super::Supervisor;

impl Supervisor {
    pub fn poll(&mut self) -> Result<(), SupervisorError> {
        self.report_pending_sidecar_log_error();
        if self.shutting_down {
            return Ok(());
        }
        if let Some((_, due_at)) = self.next_recovery.as_ref() {
            if Instant::now() < *due_at {
                return Ok(());
            }
            return self.attempt_recovery();
        }
        if let Some(running) = self.running_mcp.as_mut() {
            if let Some(status) = running
                .sidecar
                .try_direct_child_exit()
                .map_err(process_error)?
            {
                self.emit(SupervisorEvent::Exited {
                    service: "mcp".to_owned(),
                    status: status.code(),
                });
                let running = self
                    .running_mcp
                    .take()
                    .expect("the exited MCP handle observed above");
                self.stop_exited_owned_child("mcp", running)?;
                return self.queue_recovery("mcp");
            }
        }
        if let Some(running) = self.running.as_mut() {
            if let Some(status) = running
                .sidecar
                .try_direct_child_exit()
                .map_err(process_error)?
            {
                self.emit(SupervisorEvent::Exited {
                    service: "backend".to_owned(),
                    status: status.code(),
                });
                let running = self
                    .running
                    .take()
                    .expect("the exited backend handle observed above");
                self.stop_exited_owned_child("backend", running)?;
                return self.queue_recovery("backend");
            }
        }
        if self.liveness_probe.as_ref().is_some_and(|probe| {
            probe.consecutive_failures.load(Ordering::Relaxed)
                >= self.options.liveness_failure_threshold.max(1)
        }) {
            return self.queue_recovery("backend");
        }
        self.restore_budget_after_continuous_health();
        Ok(())
    }

    pub(super) fn queue_recovery(&mut self, failed_service: &str) -> Result<(), SupervisorError> {
        if self.shutting_down {
            return Ok(());
        }
        self.liveness_probe = None;
        self.healthy_since = None;
        // Recovery replaces the pair, so it tears down exactly what shutdown
        // does: an MCP failure is retained but never skips backend cleanup.
        self.stop_owned_sidecars()?;
        if self.restarts >= self.options.restart_limit {
            return Err(self.record_service_failure(
                failed_service,
                SupervisorError::new(
                    FailureKind::Crash,
                    format!("{failed_service} exited after restart limit was exhausted"),
                ),
            ));
        }
        let delay = self
            .options
            .restart_backoff
            .get(self.restarts)
            .copied()
            .or_else(|| self.options.restart_backoff.last().copied())
            .unwrap_or(Duration::ZERO);
        self.emit(SupervisorEvent::RecoveryQueued {
            service: failed_service.to_owned(),
        });
        self.next_recovery = Some((failed_service.to_owned(), Instant::now() + delay));
        if delay.is_zero() {
            return self.attempt_recovery();
        }
        Ok(())
    }

    pub(super) fn attempt_recovery(&mut self) -> Result<(), SupervisorError> {
        let Some((_failed_service, _)) = self.next_recovery.take() else {
            return Ok(());
        };
        self.restarts += 1;
        for service in ["backend", "mcp"] {
            if service == "backend" || self.commands.mcp.is_some() {
                self.emit(SupervisorEvent::Restarting {
                    service: service.to_owned(),
                    attempt: self.restarts,
                });
            }
        }
        match self.spawn_supervised_pair(false) {
            Ok(()) => {
                self.healthy_since = Some(Instant::now());
                Ok(())
            }
            Err(error) if error.kind == FailureKind::Migration => Err(error),
            Err(error) if self.restarts < self.options.restart_limit => {
                let service = error.service.clone();
                self.queue_recovery(&service)
            }
            Err(error) => Err(error),
        }
    }

    pub(super) fn restore_budget_after_continuous_health(&mut self) {
        if self.restarts == 0 || self.running.is_none() {
            return;
        }
        if self.commands.mcp.is_some() && self.running_mcp.is_none() {
            return;
        }
        if self
            .healthy_since
            .is_some_and(|since| since.elapsed() >= self.options.healthy_reset_interval)
        {
            self.restarts = 0;
            self.healthy_since = Some(Instant::now());
        }
    }

    /// Rearms a stopped supervised pair after a give-up. The fixed command
    /// table, pinned ports, and per-launch credential are retained.
    pub fn retry(&mut self) -> Result<(), SupervisorError> {
        if self.running.is_some() || self.running_mcp.is_some() {
            return Ok(());
        }
        self.shutting_down = false;
        self.restarts = 0;
        self.next_recovery = None;
        self.healthy_since = None;
        self.spawn_supervised_pair(!self.launched_once)?;
        self.launched_once = true;
        self.healthy_since = Some(Instant::now());
        Ok(())
    }
}

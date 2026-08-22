//! Actionable, user-facing notices raised by supervised services. Each notice
//! names one condition and the exact manual recovery for it.

use serde::Serialize;

use crate::desktop::mcp_runtime::WORKTRACKER_MCP_PORT;
use crate::sidecar_supervision::{self, SupervisorEvent};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
#[allow(dead_code)] // Concrete notices are produced by runtime integrations.
pub(crate) enum UserNoticeSeverity {
    Info,
    Warning,
    Error,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
#[allow(dead_code)] // Concrete notices are produced by runtime integrations.
pub(crate) struct UserNotice {
    pub(crate) id: String,
    pub(crate) severity: UserNoticeSeverity,
    pub(crate) title: String,
    pub(crate) message: String,
    pub(crate) acknowledgement_label: String,
}

pub(crate) fn supervisor_notice(event: &SupervisorEvent) -> Option<UserNotice> {
    mcp_unavailable_notice(event).or_else(|| mcp_port_rollover_notice(event))
}

fn mcp_unavailable_notice(event: &SupervisorEvent) -> Option<UserNotice> {
    let SupervisorEvent::Failed {
        service,
        kind,
        message,
    } = event
    else {
        return None;
    };
    if service != "mcp" {
        return None;
    }

    let recovery = if *kind == sidecar_supervision::FailureKind::Bind {
        format!(
            "Port {WORKTRACKER_MCP_PORT} is already in use. Stop the service using that port and restart Ticketry to restore external MCP connections."
        )
    } else {
        "Restart Ticketry to retry the external MCP service.".to_owned()
    };
    Some(UserNotice {
        id: "mcp-unavailable".to_owned(),
        severity: UserNoticeSeverity::Warning,
        title: "External MCP unavailable".to_owned(),
        message: format!(
            "Ticketry is running, but external MCP connections are unavailable: {message}. {recovery}"
        ),
        acknowledgement_label: "Continue without MCP".to_owned(),
    })
}

fn mcp_port_rollover_notice(event: &SupervisorEvent) -> Option<UserNotice> {
    let SupervisorEvent::McpPortRollover {
        previous_port,
        active_port,
    } = event
    else {
        return None;
    };
    if previous_port == active_port {
        return None;
    }

    Some(UserNotice {
        id: format!("mcp-port-rollover:{previous_port}:{active_port}"),
        severity: UserNoticeSeverity::Warning,
        title: "MCP connection changed".to_owned(),
        message: concat!(
            "Ticketry changed its MCP connection endpoint because the previous port was ",
            "unavailable. Agents launched before this change may encounter MCP connection ",
            "errors. Agents launched afterward already have the current endpoint and need no ",
            "action.\n\nFor each affected live terminal connection, close or disconnect it, ",
            "then use its Resume action so the resumed provider process receives the new MCP ",
            "URL. If Resume is unavailable, start a new agent."
        )
        .to_owned(),
        acknowledgement_label: "Understood".to_owned(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::desktop::service_state::USER_NOTICE_EVENT;

    #[test]
    fn mcp_rollover_notice_has_the_exact_manual_recovery_meaning() {
        let notice =
            mcp_port_rollover_notice(&sidecar_supervision::SupervisorEvent::McpPortRollover {
                previous_port: 43_101,
                active_port: 43_219,
            })
            .expect("changed MCP port produces a notice");

        assert_eq!(notice.title, "MCP connection changed");
        assert_eq!(notice.severity, UserNoticeSeverity::Warning);
        assert!(notice
            .message
            .contains("Agents launched before this change may encounter MCP connection errors."));
        assert!(notice.message.contains(
            "Agents launched afterward already have the current endpoint and need no action."
        ));
        assert!(notice.message.contains(
            "close or disconnect it, then use its Resume action so the resumed provider process receives the new MCP URL."
        ));
        assert!(notice
            .message
            .contains("If Resume is unavailable, start a new agent."));
        assert!(!notice.message.contains('<'));
        assert!(!notice.message.contains("Authorization"));
        assert!(!notice.message.contains("credential"));
    }

    #[test]
    fn mcp_bind_failure_notice_keeps_the_desktop_usable() {
        let notice = mcp_unavailable_notice(&sidecar_supervision::SupervisorEvent::Failed {
            service: "mcp".to_owned(),
            kind: sidecar_supervision::FailureKind::Bind,
            message: "could not reserve a loopback port after the configured retries".to_owned(),
        })
        .expect("MCP failure becomes a user notice");

        assert_eq!(notice.id, "mcp-unavailable");
        assert_eq!(notice.severity, UserNoticeSeverity::Warning);
        assert_eq!(notice.title, "External MCP unavailable");
        assert!(notice.message.contains("Ticketry is running"));
        assert!(notice.message.contains("Port 8123 is already in use"));
        assert_eq!(notice.acknowledgement_label, "Continue without MCP");
    }

    #[test]
    fn backend_failure_does_not_become_an_optional_mcp_notice() {
        assert!(
            mcp_unavailable_notice(&sidecar_supervision::SupervisorEvent::Failed {
                service: "backend".to_owned(),
                kind: sidecar_supervision::FailureKind::Bind,
                message: "backend bind failed".to_owned(),
            })
            .is_none()
        );
    }

    #[test]
    fn unchanged_ports_and_unrelated_supervisor_facts_are_silent() {
        let unchanged = sidecar_supervision::SupervisorEvent::McpPortRollover {
            previous_port: 43_219,
            active_port: 43_219,
        };

        assert!(mcp_port_rollover_notice(&unchanged).is_none());
        assert!(
            mcp_port_rollover_notice(&sidecar_supervision::SupervisorEvent::Ready {
                service: "mcp".to_owned(),
                port: 43_219,
            })
            .is_none()
        );
    }

    #[test]
    fn user_notice_uses_the_stable_desktop_event_contract() {
        let notice = UserNotice {
            id: "runtime-warning-1".to_owned(),
            severity: UserNoticeSeverity::Warning,
            title: "Runtime warning".to_owned(),
            message: "A native service needs your attention.".to_owned(),
            acknowledgement_label: "Understood".to_owned(),
        };

        assert_eq!(USER_NOTICE_EVENT, "desktop-user-notice");
        assert_eq!(
            serde_json::to_value(notice).expect("serialize user notice"),
            serde_json::json!({
                "id": "runtime-warning-1",
                "severity": "warning",
                "title": "Runtime warning",
                "message": "A native service needs your attention.",
                "acknowledgementLabel": "Understood",
            })
        );
    }
}

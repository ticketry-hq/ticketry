//! Actionable notices raised by process-local services.

use serde::Serialize;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
#[allow(dead_code)]
pub(crate) enum UserNoticeSeverity {
    Info,
    Warning,
    Error,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct UserNotice {
    pub(crate) id: String,
    pub(crate) severity: UserNoticeSeverity,
    pub(crate) title: String,
    pub(crate) message: String,
    pub(crate) acknowledgement_label: String,
}

pub(crate) fn mcp_unavailable() -> UserNotice {
    UserNotice {
        id: "mcp-unavailable".to_owned(),
        severity: UserNoticeSeverity::Warning,
        title: "Agent launches unavailable".to_owned(),
        message: "Ticketry could not start its MCP listener. Agent launches are blocked until this Ticketry instance owns an MCP listener. Local shells remain available. Restart Ticketry to retry.".to_owned(),
        acknowledgement_label: "Understood".to_owned(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::desktop::service_state::USER_NOTICE_EVENT;

    #[test]
    fn mcp_bind_failure_notice_describes_the_fail_closed_boundary() {
        let notice = mcp_unavailable();

        assert_eq!(notice.id, "mcp-unavailable");
        assert_eq!(notice.severity, UserNoticeSeverity::Warning);
        assert_eq!(notice.title, "Agent launches unavailable");
        assert_eq!(
            notice.message,
            "Ticketry could not start its MCP listener. Agent launches are blocked until this Ticketry instance owns an MCP listener. Local shells remain available. Restart Ticketry to retry."
        );
        assert_eq!(notice.acknowledgement_label, "Understood");
        assert!(!notice.message.contains("8123"));
        assert!(!notice.message.contains("credential"));
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

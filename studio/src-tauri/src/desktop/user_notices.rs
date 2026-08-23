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

pub(crate) fn mcp_unavailable(message: &str, recovery: &str) -> UserNotice {
    UserNotice {
        id: "mcp-unavailable".to_owned(),
        severity: UserNoticeSeverity::Warning,
        title: "External MCP unavailable".to_owned(),
        message: format!(
            "Ticketry is running, but external MCP connections are unavailable: {message}. {recovery}"
        ),
        acknowledgement_label: "Continue without MCP".to_owned(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::desktop::service_state::USER_NOTICE_EVENT;

    #[test]
    fn mcp_bind_failure_notice_keeps_the_desktop_usable() {
        let notice = mcp_unavailable(
            "could not reserve a loopback port",
            "Restart Ticketry to request another loopback endpoint.",
        );
        assert_eq!(notice.id, "mcp-unavailable");
        assert_eq!(notice.severity, UserNoticeSeverity::Warning);
        assert!(notice.message.contains("request another loopback endpoint"));
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

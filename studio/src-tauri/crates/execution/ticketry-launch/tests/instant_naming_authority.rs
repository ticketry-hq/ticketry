//! The launch authority identifies request evidence without rewriting the prompt.
use sea_orm::{ConnectionTrait, DbBackend, Statement};
use ticketry_launch::{InteractiveLaunchAuthority, TerminalLaunchKind};

#[path = "it/launch_fixture.rs"]
mod launch_fixture;

#[tokio::test]
async fn codex_instant_authority_marks_exact_request_source_and_preserves_other_launch_policy() {
    let fixture = launch_fixture::fixture().await;
    fixture
        .database
        .execute_raw(Statement::from_sql_and_values(
            DbBackend::Sqlite,
            "INSERT INTO app_settings (scope, \"key\", value, updated_at) VALUES \
             ('host', 'instant_launch', ?, CURRENT_TIMESTAMP)",
            [serde_json::json!({
                "initial_prompt": "\tTalk about 🦀. \n",
                "auto_close": false,
            })
            .to_string()
            .into()],
        ))
        .await
        .unwrap();

    let mut request = launch_fixture::caller_request(TerminalLaunchKind::Instant);
    request.prompt = Some(
        "  I wanna see what this issue with the terminal is\nplease investigate, don't edit.  "
            .into(),
    );
    request.policy_reference = Some("codex-instant-naming:v1:no-request".into());
    let resolved = fixture.authority.resolve(&request).await.unwrap();
    assert_eq!(
        resolved.prompt.as_deref(),
        Some("Talk about 🦀.\n\nI wanna see what this issue with the terminal is\nplease investigate, don't edit.")
    );
    assert_eq!(
        resolved.policy_reference.as_deref(),
        Some("codex-instant-naming:v1:request-offset:18"),
        "authority distinguishes the request after a multibyte instruction prefix"
    );
    resolved.apply(&mut request);
    assert_eq!(
        request.policy_reference.as_deref(),
        Some("codex-instant-naming:v1:request-offset:18"),
        "the caller's fake source marker is replaced before launch persistence"
    );

    for empty in [None, Some(" \n\t ".into())] {
        let mut request = launch_fixture::caller_request(TerminalLaunchKind::Instant);
        request.prompt = empty;
        let resolved = fixture.authority.resolve(&request).await.unwrap();
        assert_eq!(resolved.prompt.as_deref(), Some("Talk about 🦀."));
        assert_eq!(
            resolved.policy_reference.as_deref(),
            Some("codex-instant-naming:v1:no-request")
        );
    }

    let mut claude = launch_fixture::caller_request(TerminalLaunchKind::Instant);
    claude.provider = Some("claude".into());
    let resolved = fixture.authority.resolve(&claude).await.unwrap();
    assert_eq!(resolved.policy_reference, None);
    assert_eq!(
        resolved.prompt.as_deref(),
        Some("Talk about 🦀.\n\ncaller text")
    );
    let planning = fixture
        .authority
        .resolve(&launch_fixture::caller_request(
            TerminalLaunchKind::Planning,
        ))
        .await
        .unwrap();
    assert_eq!(planning.policy_reference, None);
    let task = fixture
        .authority
        .resolve(&launch_fixture::caller_request(TerminalLaunchKind::Task))
        .await
        .unwrap();
    assert!(task
        .policy_reference
        .as_deref()
        .is_some_and(|reference| !reference.starts_with("codex-instant-naming:")));
}

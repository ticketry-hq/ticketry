use std::sync::atomic::Ordering;

use sea_orm::{ConnectionTrait, DatabaseConnection, EntityTrait, PaginatorTrait};
use ticketry_agent_execution::run_now::{RunNowCaller, RunNowRefusal, RunNowRequest};
use ticketry_entities::{issue, launch_policy_decision, transition_occurrence};

use super::run_now_fixture::*;
#[tokio::test]
async fn key_resolution_excludes_only_the_authenticated_caller_and_launches_after_commit() {
    let fixture = fixture(None).await;
    insert_live_run(&fixture.database, CALLER_RUN).await;
    fixture
        .database
        .execute_unprepared(&format!(
            "INSERT INTO agent_terminal_sessions \
             (agent_run_id, tmux_session_name, task_id, module_id, project_id, created_at, scope) \
             VALUES ('{CALLER_RUN}', 'caller', '{TASK}', '{MODULE}', '{PROJECT}', CURRENT_TIMESTAMP, 'task')"
        ))
        .await
        .unwrap();
    let success = fixture
        .service
        .execute(RunNowRequest {
            id_or_key: "meml-9".to_owned(),
            request_identity: "stable-mcp-request".to_owned(),
            caller: RunNowCaller::Agent {
                authenticated_run_id: CALLER_RUN.to_owned(),
            },
        })
        .await
        .unwrap();

    assert_eq!(success.code, "run_now_started");
    assert_eq!(success.committed_state.name, "Implement");
    assert_eq!(success.run.agent_run_id, "run-now-agent");
    assert_eq!(fixture.launches.load(Ordering::SeqCst), 1);
    assert_eq!(
        state_id(&fixture.database).await.as_deref(),
        Some(IMPLEMENT)
    );
    let decision = launch_policy_decision::Entity::find()
        .one(&fixture.database)
        .await
        .unwrap()
        .unwrap();
    assert_eq!(decision.caller_scope, "run_now");
    assert_eq!(decision.idempotency_key, "stable-mcp-request");
    assert!(decision.delivered_at.is_some());
    assert!(!decision.decision_json.contains("credential"));
    assert!(!decision.decision_json.contains("authorization"));
    assert!(!decision.decision_json.contains("command"));
    let occurrence = transition_occurrence::Entity::find()
        .one(&fixture.database)
        .await
        .unwrap()
        .unwrap();
    assert!(occurrence.destination_auto_start);
    assert_eq!(
        occurrence.run_now_decision_id.as_deref(),
        Some(decision.decision_id.as_str())
    );
}

#[tokio::test]
async fn replay_returns_the_settled_run_without_repeating_the_transition_or_launch() {
    let fixture = fixture(None).await;
    let first = fixture.service.execute(human(TASK)).await.unwrap();
    let replay = fixture.service.execute(human(TASK)).await.unwrap();

    assert_eq!(replay, first);
    assert_eq!(fixture.launches.load(Ordering::SeqCst), 1);
    assert_eq!(
        transition_occurrence::Entity::find()
            .count(&fixture.database)
            .await
            .unwrap(),
        1
    );
    assert_eq!(
        launch_policy_decision::Entity::find()
            .count(&fixture.database)
            .await
            .unwrap(),
        1
    );
}

#[tokio::test]
async fn retry_resumes_a_claimed_failure_but_a_fresh_identity_cannot_adopt_implement() {
    let fixture = fixture(Some("terminal_runtime_unavailable")).await;
    let failure = fixture.service.execute(human(TASK)).await.unwrap_err();
    assert_eq!(failure.committed_state.unwrap().name, "Implement");
    assert_eq!(
        launch_policy_decision::Entity::find()
            .one(&fixture.database)
            .await
            .unwrap()
            .unwrap()
            .delivered_at,
        None
    );
    assert_eq!(
        ticketry_work_management::launch_policy::pending(&fixture.database, 10)
            .await
            .unwrap()
            .len(),
        1
    );

    let mut fresh = human(TASK);
    fresh.request_identity = "fresh-request".to_owned();
    let refusal = fixture.service.execute(fresh).await.unwrap_err();
    assert_eq!(refusal.code, "run_now_not_eligible");

    let recovered = fixture.service.execute(human(TASK)).await.unwrap();
    assert_eq!(recovered.run.agent_run_id, "run-now-agent");
    assert_eq!(fixture.launches.load(Ordering::SeqCst), 2);
    assert_eq!(
        transition_occurrence::Entity::find()
            .count(&fixture.database)
            .await
            .unwrap(),
        1
    );
}

#[tokio::test]
async fn concurrent_same_and_distinct_identities_commit_one_claim_and_one_launch() {
    for distinct in [false, true] {
        let fixture = fixture(None).await;
        let first = human(TASK);
        let mut second = human(TASK);
        if distinct {
            second.request_identity = "request-2".to_owned();
        }
        let (left, right) = tokio::join!(
            fixture.service.execute(first),
            fixture.service.execute(second)
        );
        assert_eq!(
            usize::from(left.is_ok()) + usize::from(right.is_ok()),
            if distinct { 1 } else { 2 }
        );
        assert_eq!(fixture.launches.load(Ordering::SeqCst), 1);
        assert_eq!(
            transition_occurrence::Entity::find()
                .count(&fixture.database)
                .await
                .unwrap(),
            1
        );
        let occurrence = transition_occurrence::Entity::find()
            .one(&fixture.database)
            .await
            .unwrap()
            .unwrap();
        assert!(occurrence.run_now_decision_id.is_some());
    }
}

#[tokio::test]
async fn run_now_with_another_live_run_replaces_it_and_launches_once() {
    let live_run_fixture = fixture(None).await;
    insert_live_run(&live_run_fixture.database, CALLER_RUN).await;
    insert_live_run(&live_run_fixture.database, OTHER_RUN).await;
    let success = live_run_fixture
        .service
        .execute(RunNowRequest {
            id_or_key: TASK.to_owned(),
            request_identity: "request-live".to_owned(),
            caller: RunNowCaller::Agent {
                authenticated_run_id: CALLER_RUN.to_owned(),
            },
        })
        .await
        .unwrap();
    assert_eq!(success.code, "run_now_started");
    assert_eq!(success.committed_state.name, "Implement");
    assert_eq!(live_run_fixture.launches.load(Ordering::SeqCst), 1);
    assert_eq!(
        state_id(&live_run_fixture.database).await.as_deref(),
        Some(IMPLEMENT)
    );

    let live_terminal_fixture = fixture(None).await;
    insert_live_run(&live_terminal_fixture.database, OTHER_RUN).await;
    live_terminal_fixture
        .database
        .execute_unprepared(&format!(
            "INSERT INTO agent_terminal_sessions \
             (agent_run_id, tmux_session_name, task_id, module_id, project_id, created_at, scope) \
             VALUES ('{OTHER_RUN}', 'other', '{TASK}', '{MODULE}', '{PROJECT}', CURRENT_TIMESTAMP, 'task')"
        ))
        .await
        .unwrap();
    let success = live_terminal_fixture
        .service
        .execute(human(TASK))
        .await
        .unwrap();
    assert_eq!(success.code, "run_now_started");
    assert_eq!(success.committed_state.name, "Implement");
    assert_eq!(live_terminal_fixture.launches.load(Ordering::SeqCst), 1);
    assert_eq!(
        state_id(&live_terminal_fixture.database).await.as_deref(),
        Some(IMPLEMENT)
    );
}

#[tokio::test]
async fn eligibility_origin_policy_skill_and_folder_refusals_precede_the_move() {
    let cases = [
        (
            "UPDATE worktracker_issuetype SET name = 'Task' WHERE id = '30000000000000000000000000000000'",
            "run_now_not_eligible",
            false,
        ),
        (
            "UPDATE worktracker_issuetypetransition SET agent_allowed = 0",
            "human_only_transition",
            true,
        ),
        (
            "DELETE FROM worktracker_launchbinding",
            "binding_not_configured",
            false,
        ),
        (
            "UPDATE worktracker_launchbinding SET required_skills = '[\"missing-skill\"]'",
            "invalid_required_skills",
            false,
        ),
        (
            "UPDATE worktracker_provider SET activated = 0",
            "provider_not_activated",
            false,
        ),
        (
            "DELETE FROM worktracker_agentmodel",
            "unsupported_model",
            false,
        ),
        (
            "UPDATE worktracker_issue SET parent_id = NULL, module_id = NULL WHERE id = '60000000000000000000000000000000'",
            "module_id_required",
            false,
        ),
    ];
    for (mutation, code, agent_origin) in cases {
        let fixture = fixture(None).await;
        fixture.database.execute_unprepared(mutation).await.unwrap();
        let mut request = human(TASK);
        request.request_identity = format!("request-{code}");
        if agent_origin {
            request.caller = RunNowCaller::Agent {
                authenticated_run_id: "authenticated-but-not-live".to_owned(),
            };
        }
        let refusal = fixture.service.execute(request).await.unwrap_err();
        assert_eq!(refusal.code, code);
        assert!(refusal.committed_state.is_none());
        assert_eq!(state_id(&fixture.database).await.as_deref(), Some(IDEAS));
        assert_eq!(fixture.launches.load(Ordering::SeqCst), 0);
    }

    let folder_fixture = fixture(None).await;
    link_module(&folder_fixture.database, "/path/that/does/not/exist").await;
    let refusal = folder_fixture
        .service
        .execute(human(TASK))
        .await
        .unwrap_err();
    assert_eq!(refusal.code, "module_folder_unusable");
    assert_eq!(
        state_id(&folder_fixture.database).await.as_deref(),
        Some(IDEAS)
    );
    assert_eq!(folder_fixture.launches.load(Ordering::SeqCst), 0);
}

#[tokio::test]
async fn transition_failure_rolls_back_and_late_launch_failure_reports_the_commit() {
    let rejected_transition = fixture(None).await;
    rejected_transition
        .database
        .execute_unprepared(&format!(
            "CREATE TRIGGER reject_run_now BEFORE UPDATE OF state_id ON worktracker_issue \
             WHEN OLD.id = '{TASK}' BEGIN SELECT RAISE(ABORT, 'transition rejected'); END"
        ))
        .await
        .unwrap();
    let refusal = rejected_transition
        .service
        .execute(human(TASK))
        .await
        .unwrap_err();
    assert_eq!(refusal.code, "transition_rejected");
    assert!(refusal.committed_state.is_none());
    assert_eq!(
        state_id(&rejected_transition.database).await.as_deref(),
        Some(IDEAS)
    );
    assert_eq!(rejected_transition.launches.load(Ordering::SeqCst), 0);
    assert_eq!(
        transition_occurrence::Entity::find()
            .count(&rejected_transition.database)
            .await
            .unwrap(),
        0
    );
    assert!(
        ticketry_work_management::launch_policy::pending(&rejected_transition.database, 10,)
            .await
            .unwrap()
            .is_empty(),
        "an unclaimed Run Now policy decision must not execute during startup reconciliation"
    );

    let fixture = fixture(Some("terminal_runtime_unavailable")).await;
    let refusal = fixture.service.execute(human(TASK)).await.unwrap_err();
    assert_eq!(refusal.code, "launch_unavailable");
    assert_eq!(refusal.committed_state.unwrap().name, "Implement");
    assert!(refusal.run.is_none());
    assert_eq!(
        state_id(&fixture.database).await.as_deref(),
        Some(IMPLEMENT)
    );
    assert_eq!(fixture.launches.load(Ordering::SeqCst), 1);
}

const CHILD: &str = "60000000000000000000000000000001";
const DONE: &str = "40000000000000000000000000000002";

async fn insert_child(database: &DatabaseConnection, parent: &str, state: &str, archived: bool) {
    database
        .execute_unprepared(&format!(
            "INSERT INTO worktracker_issue (id, project_id, type, issue_type_id, parent_id, module_id, state_id, state_revision, name, sequence_id, is_archived, rank, description, workspace_tab_order, created_at, updated_at) VALUES \
             ('{CHILD}', '{PROJECT}', 'task', '{STORY}', '{parent}', '{MODULE}', '{state}', 4, \
              'Subtask', 10, {archived}, 'O', '', '[]', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)",
            archived = u8::from(archived),
        ))
        .await
        .unwrap();
}

async fn assert_refused_without_mutation(fixture: &Fixture, refusal: RunNowRefusal) {
    assert_eq!(refusal.code, "story_has_subtasks");
    assert!(refusal.detail.contains("subtasks"));
    assert!(refusal.committed_state.is_none());
    let story = issue::Entity::find_by_id(TASK)
        .one(&fixture.database)
        .await
        .unwrap()
        .unwrap();
    assert_eq!(story.state_id.as_deref(), Some(IDEAS));
    assert_eq!(story.issue_type_id, STORY);
    assert_eq!(fixture.launches.load(Ordering::SeqCst), 0);
    assert_eq!(
        transition_occurrence::Entity::find()
            .count(&fixture.database)
            .await
            .unwrap(),
        0
    );
    assert!(
        ticketry_work_management::launch_policy::pending(&fixture.database, 10)
            .await
            .unwrap()
            .is_empty()
    );
}

#[tokio::test]
async fn any_direct_child_refuses_run_now_without_touching_the_story_or_child() {
    for (child_state, archived) in [(IDEAS, false), (DONE, false), (IDEAS, true)] {
        let fixture = fixture(None).await;
        fixture
            .database
            .execute_unprepared(&format!(
                "INSERT INTO worktracker_state VALUES ('{DONE}', '{PROJECT}', 'Done', \
                 'completed', '', 2, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)"
            ))
            .await
            .unwrap();
        insert_child(&fixture.database, TASK, child_state, archived).await;
        let before = issue::Entity::find_by_id(CHILD)
            .one(&fixture.database)
            .await
            .unwrap();

        let refusal = fixture.service.execute(human(TASK)).await.unwrap_err();

        assert_refused_without_mutation(&fixture, refusal).await;
        assert_eq!(
            launch_policy_decision::Entity::find()
                .count(&fixture.database)
                .await
                .unwrap(),
            0,
            "the child refusal precedes launch-policy resolution"
        );
        assert_eq!(
            issue::Entity::find_by_id(CHILD)
                .one(&fixture.database)
                .await
                .unwrap(),
            before
        );
    }
}

#[tokio::test]
async fn a_child_committed_after_preflight_is_refused_inside_the_guarded_transition() {
    let created = format!(
        "INSERT INTO worktracker_issue (id, project_id, type, issue_type_id, parent_id, module_id, state_id, state_revision, name, sequence_id, is_archived, rank, description, workspace_tab_order, created_at, updated_at) VALUES \
         ('{CHILD}', '{PROJECT}', 'task', '{STORY}', '{TASK}', '{MODULE}', '{IDEAS}', 4, \
          'Late subtask', 10, 0, 'O', '', '[]', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);"
    );
    let reparented =
        format!("UPDATE worktracker_issue SET parent_id = '{TASK}' WHERE id = '{CHILD}';");
    for (seed_sibling, late_write) in [(false, created), (true, reparented)] {
        let fixture = fixture(None).await;
        if seed_sibling {
            insert_child(&fixture.database, MODULE, IDEAS, false).await;
        }
        // Policy recording sits between the preflight read and the guarded
        // transition, so this write lands exactly in the race window.
        fixture
            .database
            .execute_unprepared(&format!(
                "CREATE TRIGGER late_child AFTER INSERT ON ticketry_launchpolicydecision \
                 BEGIN {late_write} END"
            ))
            .await
            .unwrap();

        let refusal = fixture.service.execute(human(TASK)).await.unwrap_err();

        assert_refused_without_mutation(&fixture, refusal).await;
    }
}

#[tokio::test]
async fn concurrent_child_creation_either_precedes_and_refuses_or_follows_the_commit() {
    use ticketry_work_management::commands::work_items::{create, CreateWorkItem};
    for attempt in 0..8 {
        let fixture = fixture(None).await;
        let mut request = human(TASK);
        request.request_identity = format!("race-{attempt}");
        let (run_now, child) = tokio::join!(
            fixture.service.execute(request),
            create(
                &fixture.database,
                CreateWorkItem {
                    project_id: PROJECT.to_owned(),
                    name: "Racing subtask".to_owned(),
                    issue_type_id: STORY.to_owned(),
                    description: None,
                    state_id: None,
                    parent_id: Some(TASK.to_owned()),
                },
                None,
            )
        );
        let child = issue::Entity::find_by_id(child.unwrap().replace('-', ""))
            .one(&fixture.database)
            .await
            .unwrap()
            .unwrap();
        match run_now {
            Ok(_) => {
                let occurrence = transition_occurrence::Entity::find()
                    .one(&fixture.database)
                    .await
                    .unwrap()
                    .unwrap();
                assert!(
                    child.state_revision > occurrence.work_item_revision,
                    "a child may only appear after the Run Now commit"
                );
            }
            Err(refusal) => assert_refused_without_mutation(&fixture, refusal).await,
        }
    }
}

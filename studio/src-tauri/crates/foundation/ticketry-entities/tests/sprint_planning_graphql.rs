use sea_orm::{ActiveModelTrait, ConnectionTrait, Database, EntityTrait, Set};
use ticketry_entities::{sprint, sprint_goal, sprint_suggestion};

#[tokio::test]
async fn sprint_entities_validate_goal_text_and_waiting_proposals() {
    let database = Database::connect("sqlite::memory:").await.unwrap();
    let project_id = uuid::Uuid::new_v4().simple().to_string();
    database.execute_unprepared(&format!(
        "CREATE TABLE worktracker_project (id TEXT PRIMARY KEY, name TEXT, slug TEXT, description TEXT, seq_counter INTEGER, state_revision INTEGER, created_at TEXT, updated_at TEXT, onboarding_required INTEGER); INSERT INTO worktracker_project VALUES ('{project_id}', 'P', 'p', '', 0, 0, '2026-10-03 00:00:00', '2026-10-03 00:00:00', 0);"
    )).await.unwrap();
    for sql in [
        "CREATE TABLE worktracker_issue (id TEXT PRIMARY KEY, project_id TEXT, type TEXT, issue_type_id TEXT, parent_id TEXT, module_id TEXT, state_id TEXT, sprint_id TEXT, state_revision INTEGER, name TEXT, sequence_id INTEGER, is_archived INTEGER, rank TEXT, description TEXT, workspace_tab_order TEXT, created_at TEXT, updated_at TEXT)",
        "CREATE TABLE worktracker_sprint (id TEXT PRIMARY KEY, project_id TEXT, name TEXT, status TEXT, suggestion_run_id TEXT, goals_revised_at TEXT, created_at TEXT, updated_at TEXT)",
        "CREATE TABLE worktracker_sprint_goal (id TEXT PRIMARY KEY, sprint_id TEXT, position INTEGER, text TEXT, created_at TEXT, updated_at TEXT)",
        "CREATE TABLE worktracker_sprint_suggestion (id TEXT PRIMARY KEY, sprint_id TEXT, goal_id TEXT, issue_id TEXT, proposed_name TEXT, proposed_epic_id TEXT, reason TEXT, status TEXT, run_id TEXT, created_at TEXT)",
    ] { database.execute_unprepared(sql).await.unwrap(); }
    let sprint = sprint::ActiveModel {
        project_id: Set(project_id),
        name: Set("  Sprint 1  ".into()),
        ..Default::default()
    }
    .insert(&database)
    .await
    .unwrap();
    assert_eq!(sprint.status, "planned");
    assert_eq!(sprint.name, "Sprint 1");
    assert!(uuid::Uuid::parse_str(&sprint.id).is_ok());
    assert_eq!(sprint.suggestion_run_id, None);
    assert_eq!(sprint.goals_revised_at, None);
    let goal = sprint_goal::ActiveModel {
        sprint_id: Set(sprint.id.clone()),
        position: Set(1),
        text: Set("  Ship planning  ".into()),
        ..Default::default()
    }
    .insert(&database)
    .await
    .unwrap();
    assert_eq!(goal.text, "Ship planning");
    assert!(sprint_goal::ActiveModel {
        sprint_id: Set(sprint.id.clone()),
        position: Set(2),
        text: Set("   ".into()),
        ..Default::default()
    }
    .insert(&database)
    .await
    .is_err());
    let suggestion = sprint_suggestion::ActiveModel {
        sprint_id: Set(sprint.id.clone()),
        goal_id: Set(goal.id.clone()),
        proposed_name: Set(Some("A new story".into())),
        reason: Set("It fits G1".into()),
        run_id: Set("run-1".into()),
        ..Default::default()
    }
    .insert(&database)
    .await
    .unwrap();
    assert_eq!(suggestion.status, "waiting");
    assert_eq!(suggestion.issue_id, None);
    assert!(sprint_suggestion::ActiveModel {
        sprint_id: Set(sprint.id.clone()),
        goal_id: Set(goal.id.clone()),
        reason: Set("No target".into()),
        run_id: Set("run-1".into()),
        ..Default::default()
    }
    .insert(&database)
    .await
    .is_err());
    assert_eq!(
        sprint_suggestion::Entity::find()
            .all(&database)
            .await
            .unwrap()
            .len(),
        1
    );
    let local_issue_id = uuid::Uuid::new_v4().simple().to_string();
    let foreign_issue_id = uuid::Uuid::new_v4().simple().to_string();
    let foreign_project_id = uuid::Uuid::new_v4().simple().to_string();
    for (id, project_id) in [
        (&local_issue_id, &sprint.project_id),
        (&foreign_issue_id, &foreign_project_id),
    ] {
        database.execute_unprepared(&format!("INSERT INTO worktracker_issue VALUES ('{id}', '{project_id}', 'task', 'type', NULL, NULL, NULL, NULL, 0, 'Story', 1, 0, 'a', '', '[]', '2026-10-03 00:00:00', '2026-10-03 00:00:00')")).await.unwrap();
    }
    let accepted_from_waiting = sprint_suggestion::ActiveModel {
        id: Set(suggestion.id.clone()),
        issue_id: Set(Some(local_issue_id.clone())),
        status: Set("accepted".into()),
        ..Default::default()
    }
    .update(&database)
    .await
    .unwrap();
    assert_eq!(accepted_from_waiting.status, "accepted");
    assert_eq!(
        accepted_from_waiting.proposed_name.as_deref(),
        Some("A new story")
    );
    assert_eq!(
        accepted_from_waiting.issue_id.as_deref(),
        Some(local_issue_id.as_str())
    );
    assert_eq!(accepted_from_waiting.reason, "It fits G1");
    assert_eq!(accepted_from_waiting.sprint_id, sprint.id);
    assert_eq!(accepted_from_waiting.goal_id, goal.id);
    let proposed = sprint_suggestion::ActiveModel {
        sprint_id: Set(sprint.id.clone()),
        goal_id: Set(goal.id.clone()),
        issue_id: Set(Some(local_issue_id.clone())),
        proposed_name: Set(Some("New story".into())),
        reason: Set("G1".into()),
        run_id: Set("run-1".into()),
        ..Default::default()
    };
    assert!(proposed.clone().insert(&database).await.is_err());
    let accepted = sprint_suggestion::ActiveModel {
        status: Set("accepted".into()),
        ..proposed
    }
    .insert(&database)
    .await
    .unwrap();
    assert_eq!(accepted.issue_id.as_deref(), Some(local_issue_id.as_str()));
    assert_eq!(accepted.proposed_name.as_deref(), Some("New story"));
    assert!(sprint_suggestion::ActiveModel {
        sprint_id: Set(sprint.id.clone()),
        goal_id: Set(goal.id.clone()),
        issue_id: Set(Some(foreign_issue_id.clone())),
        reason: Set("G1".into()),
        run_id: Set("run-1".into()),
        ..Default::default()
    }
    .insert(&database)
    .await
    .is_err());
    assert!(sprint_suggestion::ActiveModel {
        sprint_id: Set(sprint.id),
        goal_id: Set(goal.id),
        proposed_name: Set(Some("New story".into())),
        proposed_epic_id: Set(Some(foreign_issue_id)),
        reason: Set("G1".into()),
        run_id: Set("run-1".into()),
        ..Default::default()
    }
    .insert(&database)
    .await
    .is_err());
}

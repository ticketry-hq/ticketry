use sea_orm::{
    ActiveModelTrait, ConnectionTrait, Database, DatabaseConnection, EntityTrait, NotSet, Set,
};
use ticketry_agent_execution::graph::{
    dependency_graph, relevant_armed_roots, scheduling_facts, GraphAccess, GraphFactsErrorCode,
};
use ticketry_entities::{
    agent_run, session as terminal_session, {graph_run, launch_claim},
    {issue, issue_blocker, state},
};

const PROJECT: &str = "project-a";
const MODULE: &str = "module-a";
const ROOT: &str = "root";

#[tokio::test]
async fn factual_graph_is_current_without_a_campaign() {
    let database = fixture().await;
    seed_graph(&database).await;

    let graph = dependency_graph(&database, ROOT, &GraphAccess::project(PROJECT))
        .await
        .unwrap();

    assert_eq!(
        graph
            .nodes
            .iter()
            .map(|node| node.id.as_str())
            .collect::<Vec<_>>(),
        [
            ROOT,
            "child-a",
            "child-b",
            "child-c",
            "child-d",
            "grandchild"
        ]
    );
    assert_eq!(
        graph
            .nodes
            .iter()
            .find(|node| node.id == "child-b")
            .unwrap()
            .blocked_by,
        ["child-a"]
    );
    assert!(graph
        .nodes
        .iter()
        .find(|node| node.id == ROOT)
        .unwrap()
        .blocked_by
        .is_empty());
    assert!(!graph
        .nodes
        .iter()
        .any(|node| { matches!(node.id.as_str(), "archived-child" | "hidden-grandchild") }));
}

#[tokio::test]
async fn scheduling_reads_external_blockers_liveness_and_claims_independently() {
    let database = fixture().await;
    seed_graph(&database).await;
    state::ActiveModel {
        id: Set("review".to_owned()),
        project_id: Set(PROJECT.to_owned()),
        name: Set("Review".to_owned()),
        group: Set("started".to_owned()),
        color: Set(String::new()),
        sort_order: Set(3),
        is_protected: Set(false),
        created_at: Set(now()),
        updated_at: Set(now()),
    }
    .insert(&database)
    .await
    .unwrap();
    let mut external: issue::ActiveModel = issue::Entity::find_by_id("external")
        .one(&database)
        .await
        .unwrap()
        .unwrap()
        .into();
    external.state_id = Set(Some("review".to_owned()));
    external.update(&database).await.unwrap();

    insert_graph_run(&database).await;
    insert_claim(&database, "child-c", "ended-claim").await;
    insert_run(&database, "ended-claim", "child-c", Some("ended")).await;
    insert_run(&database, "terminal-run", "child-a", Some("ended")).await;
    insert_terminal(&database, "terminal-run", "child-a", None).await;
    insert_run(&database, "live-run", "child-d", None).await;

    let facts = scheduling_facts(&database, ROOT, &GraphAccess::project(PROJECT), None)
        .await
        .unwrap();
    assert_eq!(
        facts
            .iter()
            .map(|facts| facts.child.id.as_str())
            .collect::<Vec<_>>(),
        ["child-a", "child-b", "child-c", "child-d"]
    );
    let by_id = |id: &str| facts.iter().find(|facts| facts.child.id == id).unwrap();
    assert!(by_id("child-a").has_live_work);
    assert_eq!(
        by_id("child-a").blockers[0].state_name.as_deref(),
        Some("Review")
    );
    assert!(by_id("child-c").has_campaign_claim);
    assert!(!by_id("child-c").has_live_work);
    assert!(by_id("child-d").has_live_work);
    assert!(!facts.iter().any(|facts| facts.child.id == "grandchild"));
}

#[tokio::test]
async fn caller_exclusion_normalizes_the_run_identity_and_excludes_only_its_terminal() {
    const CALLER_RUN: &str = "44444444444444444444444444444444";
    const CALLER_RUN_HYPHENATED: &str = "44444444-4444-4444-4444-444444444444";

    let database = fixture().await;
    seed_graph(&database).await;
    insert_run(&database, CALLER_RUN, "child-a", None).await;
    insert_terminal(&database, CALLER_RUN, "child-a", None).await;
    insert_run(&database, "other-live-run", "child-b", None).await;
    insert_terminal(&database, "ended-run", "child-c", None).await;

    let facts = scheduling_facts(
        &database,
        ROOT,
        &GraphAccess::project(PROJECT),
        Some(CALLER_RUN_HYPHENATED),
    )
    .await
    .unwrap();
    let by_id = |id: &str| facts.iter().find(|facts| facts.child.id == id).unwrap();

    assert!(!by_id("child-a").has_live_work);
    assert!(by_id("child-b").has_live_work);
    assert!(by_id("child-c").has_live_work);
    assert!(!by_id("child-d").has_live_work);
}

#[tokio::test]
async fn one_changed_item_resolves_only_indexed_armed_roots() {
    let database = fixture().await;
    seed_graph(&database).await;
    insert_graph_run(&database).await;

    assert_eq!(
        relevant_armed_roots(&database, "external", &GraphAccess::project(PROJECT))
            .await
            .unwrap(),
        [ROOT]
    );
    assert_eq!(
        relevant_armed_roots(&database, "child-a", &GraphAccess::project(PROJECT))
            .await
            .unwrap(),
        [ROOT]
    );
    assert!(
        relevant_armed_roots(&database, "unrelated", &GraphAccess::project(PROJECT))
            .await
            .unwrap()
            .is_empty()
    );

    let mut root: issue::ActiveModel = issue::Entity::find_by_id(ROOT)
        .one(&database)
        .await
        .unwrap()
        .unwrap()
        .into();
    root.is_archived = Set(true);
    root.update(&database).await.unwrap();
    assert!(
        relevant_armed_roots(&database, "child-a", &GraphAccess::project(PROJECT))
            .await
            .unwrap()
            .is_empty()
    );
}

#[tokio::test]
async fn root_failures_have_stable_codes() {
    let database = fixture().await;
    seed_graph(&database).await;
    insert_issue(
        &database,
        "archived-root",
        "task",
        Some(MODULE),
        Some(MODULE),
        "todo",
        20,
        true,
    )
    .await;
    insert_issue(
        &database,
        "orphan-root",
        "task",
        None,
        None,
        "todo",
        21,
        false,
    )
    .await;
    insert_issue(
        &database,
        "orphan-child",
        "task",
        Some("orphan-root"),
        None,
        "todo",
        22,
        false,
    )
    .await;
    insert_issue(
        &database,
        "empty-root",
        "task",
        Some(MODULE),
        Some(MODULE),
        "todo",
        23,
        false,
    )
    .await;

    for (root, access, code) in [
        (
            "missing",
            GraphAccess::project(PROJECT),
            GraphFactsErrorCode::TaskNotFound,
        ),
        (
            "archived-root",
            GraphAccess::project(PROJECT),
            GraphFactsErrorCode::RootArchived,
        ),
        (
            "orphan-root",
            GraphAccess::project(PROJECT),
            GraphFactsErrorCode::RootUnscoped,
        ),
        (
            "empty-root",
            GraphAccess::project(PROJECT),
            GraphFactsErrorCode::GraphEmpty,
        ),
        (
            ROOT,
            GraphAccess::project("project-b"),
            GraphFactsErrorCode::Unauthorized,
        ),
        (
            ROOT,
            GraphAccess::caller_roots(PROJECT, ["some-other-root"]),
            GraphFactsErrorCode::Unauthorized,
        ),
    ] {
        assert_eq!(
            dependency_graph(&database, root, &access)
                .await
                .unwrap_err()
                .code(),
            code
        );
    }
}

async fn fixture() -> DatabaseConnection {
    let database = Database::connect("sqlite::memory:").await.unwrap();
    database
        .execute_unprepared(
            r#"
            CREATE TABLE worktracker_state (
                id TEXT PRIMARY KEY, project_id TEXT NOT NULL, name TEXT NOT NULL,
                "group" TEXT NOT NULL, color TEXT NOT NULL, sort_order INTEGER NOT NULL,
                is_protected BOOLEAN NOT NULL, created_at DATETIME NOT NULL, updated_at DATETIME NOT NULL
            );
            CREATE TABLE worktracker_issue (
                id TEXT PRIMARY KEY, project_id TEXT NOT NULL, type TEXT NOT NULL,
                issue_type_id TEXT NOT NULL, parent_id TEXT, module_id TEXT, state_id TEXT,
                state_revision INTEGER NOT NULL, name TEXT NOT NULL, sequence_id INTEGER NOT NULL,
                is_archived BOOLEAN NOT NULL, rank TEXT NOT NULL, description TEXT NOT NULL,
                created_at DATETIME NOT NULL, updated_at DATETIME NOT NULL
            );
            CREATE INDEX issue_parent_scope ON worktracker_issue(parent_id, type, is_archived, sequence_id, id);
            CREATE TABLE worktracker_issue_blocked_by (
                id INTEGER PRIMARY KEY AUTOINCREMENT, from_issue_id TEXT NOT NULL, to_issue_id TEXT NOT NULL
            );
            CREATE INDEX blocker_lookup ON worktracker_issue_blocked_by(to_issue_id, from_issue_id);
            CREATE TABLE graph_runs (
                root_id TEXT PRIMARY KEY, agent TEXT, created_at DATETIME NOT NULL,
                updated_at DATETIME NOT NULL, module_id TEXT, project_id TEXT NOT NULL,
                execution_mode TEXT NOT NULL, launch_configuration TEXT
            );
            CREATE TABLE launched_tasks (
                task_id TEXT PRIMARY KEY, claim_id TEXT NOT NULL UNIQUE,
                agent_run_id TEXT NOT NULL, launch_effect_id TEXT NOT NULL UNIQUE,
                launch_generation INTEGER NOT NULL, launched_at DATETIME NOT NULL,
                root_id TEXT NOT NULL
            );
            CREATE TABLE agent_runs (
                id TEXT PRIMARY KEY, issue_id TEXT NOT NULL, ticket_seq INTEGER, agent TEXT,
                model TEXT, reasoning TEXT, status TEXT NOT NULL, started_at TEXT NOT NULL,
                ended_at TEXT, exit_code INTEGER, error TEXT, cwd TEXT, provider_session_id TEXT,
                lifecycle_state TEXT, lifecycle_updated_at TEXT, design_dir TEXT, resumed_from TEXT,
                scope TEXT NOT NULL, launch_state TEXT, launch_model TEXT
            );
            CREATE TABLE agent_terminal_sessions (
                agent_run_id TEXT PRIMARY KEY, tmux_session_name TEXT NOT NULL, task_id TEXT NOT NULL,
                module_id TEXT NOT NULL, project_id TEXT NOT NULL, created_at TEXT NOT NULL,
                terminated_at TEXT, scope TEXT NOT NULL, doc_rel_path TEXT,
                runtime_cleanup_pending BOOLEAN NOT NULL, runtime_namespace TEXT,
                output_identity TEXT, output_sequence INTEGER NOT NULL, last_output_at TEXT, agent TEXT
            );
            CREATE INDEX terminal_task_liveness ON agent_terminal_sessions(task_id, terminated_at);
            "#,
        )
        .await
        .unwrap();
    database
}

async fn seed_graph(database: &DatabaseConnection) {
    for (id, name, group) in [
        ("todo", "Todo", "unstarted"),
        ("done", "Done", "completed"),
        ("cancelled", "Cancelled", "cancelled"),
    ] {
        state::ActiveModel {
            id: Set(id.to_owned()),
            project_id: Set(PROJECT.to_owned()),
            name: Set(name.to_owned()),
            group: Set(group.to_owned()),
            color: Set(String::new()),
            sort_order: Set(1),
            is_protected: Set(false),
            created_at: Set(now()),
            updated_at: Set(now()),
        }
        .insert(database)
        .await
        .unwrap();
    }
    insert_issue(database, MODULE, "module", None, None, "todo", 1, false).await;
    insert_issue(
        database,
        ROOT,
        "task",
        Some(MODULE),
        Some(MODULE),
        "todo",
        2,
        false,
    )
    .await;
    insert_issue(
        database,
        "child-b",
        "task",
        Some(ROOT),
        Some(MODULE),
        "todo",
        7,
        false,
    )
    .await;
    insert_issue(
        database,
        "child-a",
        "task",
        Some(ROOT),
        Some(MODULE),
        "todo",
        7,
        false,
    )
    .await;
    insert_issue(
        database,
        "child-c",
        "task",
        Some(ROOT),
        Some(MODULE),
        "todo",
        8,
        false,
    )
    .await;
    insert_issue(
        database,
        "child-d",
        "task",
        Some(ROOT),
        Some(MODULE),
        "todo",
        9,
        false,
    )
    .await;
    insert_issue(
        database,
        "grandchild",
        "task",
        Some("child-a"),
        Some(MODULE),
        "todo",
        10,
        false,
    )
    .await;
    insert_issue(
        database,
        "archived-child",
        "task",
        Some(ROOT),
        Some(MODULE),
        "todo",
        11,
        true,
    )
    .await;
    insert_issue(
        database,
        "hidden-grandchild",
        "task",
        Some("archived-child"),
        Some(MODULE),
        "todo",
        12,
        false,
    )
    .await;
    insert_issue(
        database,
        "external",
        "task",
        Some(MODULE),
        Some(MODULE),
        "todo",
        13,
        false,
    )
    .await;
    insert_issue(
        database,
        "unrelated",
        "task",
        Some(MODULE),
        Some(MODULE),
        "todo",
        14,
        false,
    )
    .await;
    insert_edge(database, ROOT, "external").await;
    insert_edge(database, "child-a", "external").await;
    insert_edge(database, "child-b", "child-a").await;
}

#[allow(clippy::too_many_arguments)]
async fn insert_issue(
    database: &DatabaseConnection,
    id: &str,
    kind: &str,
    parent_id: Option<&str>,
    module_id: Option<&str>,
    state_id: &str,
    sequence_id: i32,
    is_archived: bool,
) {
    issue::ActiveModel {
        id: Set(id.to_owned()),
        project_id: Set(PROJECT.to_owned()),
        r#type: Set(kind.to_owned()),
        issue_type_id: Set(format!("{kind}-type")),
        parent_id: Set(parent_id.map(str::to_owned)),
        module_id: Set(module_id.map(str::to_owned)),
        state_id: Set(Some(state_id.to_owned())),
        state_revision: Set(1),
        name: Set(id.to_owned()),
        sequence_id: Set(sequence_id),
        is_archived: Set(is_archived),
        rank: Set(format!("rank-{sequence_id}")),
        description: Set(String::new()),
        workspace_tab_order: Set(serde_json::json!([])),
        created_at: Set(now()),
        updated_at: Set(now()),
    }
    .insert(database)
    .await
    .unwrap();
}

async fn insert_edge(database: &DatabaseConnection, blocked: &str, blocker: &str) {
    issue_blocker::ActiveModel {
        id: NotSet,
        from_issue_id: Set(blocked.to_owned()),
        to_issue_id: Set(blocker.to_owned()),
    }
    .insert(database)
    .await
    .unwrap();
}

async fn insert_graph_run(database: &DatabaseConnection) {
    graph_run::ActiveModel {
        root_id: Set(ROOT.to_owned()),
        agent: Set(None),
        created_at: Set(now()),
        updated_at: Set(now()),
        module_id: Set(Some(MODULE.to_owned())),
        project_id: Set(PROJECT.to_owned()),
        execution_mode: Set("parallel".to_owned()),
        launch_configuration: Set(None),
    }
    .insert(database)
    .await
    .unwrap();
}

async fn insert_claim(database: &DatabaseConnection, task_id: &str, run_id: &str) {
    launch_claim::ActiveModel {
        task_id: Set(task_id.to_owned()),
        claim_id: Set(format!("claim-{task_id}")),
        agent_run_id: Set(run_id.to_owned()),
        launch_effect_id: Set(format!("effect-{task_id}")),
        launch_generation: Set(1),
        launched_at: Set(now()),
        root_id: Set(ROOT.to_owned()),
    }
    .insert(database)
    .await
    .unwrap();
}

async fn insert_run(
    database: &DatabaseConnection,
    run_id: &str,
    task_id: &str,
    ended_at: Option<&str>,
) {
    agent_run::ActiveModel {
        id: Set(run_id.to_owned()),
        issue_id: Set(task_id.to_owned()),
        ticket_seq: Set(None),
        agent: Set(Some("codex".to_owned())),
        initial_prompt: Set(None),
        status: Set(if ended_at.is_some() {
            "exited"
        } else {
            "running"
        }
        .to_owned()),
        started_at: Set("started".to_owned()),
        ended_at: Set(ended_at.map(str::to_owned)),
        exit_code: Set(None),
        error: Set(None),
        cwd: Set(None),
        provider_session_id: Set(None),
        lifecycle_state: Set(None),
        lifecycle_updated_at: Set(None),
        design_dir: Set(None),
        resumed_from: Set(None),
        scope: Set("task".to_owned()),
        launch_state: Set(None),
        launch_model: Set(None),
        launch_reasoning: Set(None),
        launch_unattended: Set(false),
    }
    .insert(database)
    .await
    .unwrap();
}

async fn insert_terminal(
    database: &DatabaseConnection,
    run_id: &str,
    task_id: &str,
    terminated_at: Option<&str>,
) {
    terminal_session::ActiveModel {
        agent_run_id: Set(run_id.to_owned()),
        tmux_session_name: Set(run_id.to_owned()),
        task_id: Set(task_id.to_owned()),
        module_id: Set(MODULE.to_owned()),
        project_id: Set(PROJECT.to_owned()),
        created_at: Set("started".to_owned()),
        terminated_at: Set(terminated_at.map(str::to_owned)),
        scope: Set("task".to_owned()),
        doc_rel_path: Set(None),
        runtime_cleanup_pending: Set(false),
        runtime_namespace: Set(None),
        output_identity: Set(None),
        output_sequence: Set(0),
        last_output_at: Set(None),
        agent: Set(Some("codex".to_owned())),
    }
    .insert(database)
    .await
    .unwrap();
}

fn now() -> chrono::NaiveDateTime {
    chrono::NaiveDate::from_ymd_opt(2026, 8, 19)
        .unwrap()
        .and_hms_opt(12, 0, 0)
        .unwrap()
}

PRAGMA journal_mode=WAL;
CREATE TABLE worktracker_project (
    id char(32) PRIMARY KEY, name varchar(255) NOT NULL, slug varchar(64) NOT NULL,
    description text NOT NULL, seq_counter integer NOT NULL, state_revision bigint NOT NULL,
    manual_module_order bool NOT NULL, created_at datetime NOT NULL,
    updated_at datetime NOT NULL, onboarding_required bool NOT NULL
);
CREATE TABLE worktracker_state (
    id char(32) PRIMARY KEY, project_id char(32) NOT NULL, name varchar(255) NOT NULL,
    "group" varchar(32) NOT NULL, color varchar(32) NOT NULL, sort_order integer NOT NULL,
    is_protected bool NOT NULL, created_at datetime NOT NULL, updated_at datetime NOT NULL
);
CREATE TABLE worktracker_issuetype (
    id char(32) PRIMARY KEY, project_id char(32) NOT NULL, name varchar(255) NOT NULL,
    level varchar(16) NOT NULL, color varchar(32) NOT NULL, sort_order integer NOT NULL,
    start_state_id char(32), workflow_revision integer NOT NULL, is_pathfind bool NOT NULL,
    created_at datetime NOT NULL, updated_at datetime NOT NULL
);
CREATE TABLE worktracker_issue (
    id char(32) PRIMARY KEY, project_id char(32) NOT NULL, type varchar(10) NOT NULL,
    issue_type_id char(32) NOT NULL, parent_id char(32), module_id char(32),
    state_id char(32), state_revision bigint NOT NULL, name varchar(512) NOT NULL,
    sequence_id integer NOT NULL, is_archived bool NOT NULL, rank varchar(64) NOT NULL,
    description text NOT NULL, workspace_tab_order text NOT NULL DEFAULT '[]',
    created_at datetime NOT NULL, updated_at datetime NOT NULL,
    UNIQUE(project_id, sequence_id)
);
CREATE TABLE worktracker_issuetypetransition (
    id integer PRIMARY KEY AUTOINCREMENT, issue_type_id char(32) NOT NULL,
    from_state_id char(32) NOT NULL, to_state_id char(32) NOT NULL,
    agent_allowed bool NOT NULL, handoff bool NOT NULL DEFAULT 0,
    UNIQUE(issue_type_id, from_state_id, to_state_id)
);
CREATE TABLE worktracker_launchbinding (
    id integer PRIMARY KEY AUTOINCREMENT, issue_type_id char(32) NOT NULL,
    state_id char(32) NOT NULL, prompt text NOT NULL, required_skills text NOT NULL,
    entry_skill varchar(128), model_id char(32), reasoning_id char(32), auto_start bool NOT NULL,
    subtree_run_enabled bool NOT NULL, created_at datetime NOT NULL,
    updated_at datetime NOT NULL, UNIQUE(issue_type_id, state_id)
);
CREATE TABLE worktrees (
    id VARCHAR NOT NULL PRIMARY KEY, task_id VARCHAR NOT NULL UNIQUE,
    workspace_slug VARCHAR, project_id VARCHAR, module_id VARCHAR, ticket_seq INTEGER,
    repo_root VARCHAR NOT NULL, path VARCHAR NOT NULL, branch VARCHAR NOT NULL,
    base_branch VARCHAR NOT NULL, base_commit VARCHAR NOT NULL, status VARCHAR NOT NULL,
    ephemeral BOOLEAN NOT NULL, created_at VARCHAR NOT NULL, updated_at VARCHAR NOT NULL
);
CREATE TABLE runs_status_events (
    cursor INTEGER PRIMARY KEY AUTOINCREMENT, event_id TEXT NOT NULL UNIQUE,
    project_id TEXT NOT NULL, event_kind TEXT NOT NULL, payload_version INTEGER NOT NULL,
    subject_kind TEXT NOT NULL, subject_id TEXT NOT NULL, agent_run_id TEXT,
    automation_attempt_id TEXT, work_item_id TEXT, payload TEXT NOT NULL,
    committed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO worktracker_project VALUES
    ('$PROJECT', 'Coding', 'CODIN', '', 900, 1, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, 0);
INSERT INTO worktracker_state VALUES
    ('$BACKLOG', '$PROJECT', 'Backlog', 'backlog', '', 0, 0,
     CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    ('$DONE', '$PROJECT', 'Done', 'completed', '', 1, 0,
     CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
INSERT INTO worktracker_issuetype VALUES
    ('$TASK_TYPE', '$PROJECT', 'Story', 'task', '', 0, '$BACKLOG', 1, 0,
     CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    ('$MODULE_TYPE', '$PROJECT', 'Module', 'module', '', 1, NULL, 1, 0,
     CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
INSERT INTO worktracker_issue VALUES
    ('$MODULE', '$PROJECT', 'module', '$MODULE_TYPE', NULL, NULL, '$BACKLOG', 1,
     'Ticketry', 880, 0, 'y', '', '[]', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    ('$WORK_ITEM', '$PROJECT', 'task', '$TASK_TYPE', '$MODULE', '$MODULE', '$BACKLOG', 1,
     'Parent story', 881, 0, 'z', '', '[]', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
INSERT INTO worktracker_issuetypetransition
    (issue_type_id, from_state_id, to_state_id, agent_allowed)
    VALUES ('$TASK_TYPE', '$BACKLOG', '$DONE', 1);
INSERT INTO worktrees VALUES (
    '70000000000000000000000000000001', '$WORK_ITEM', 'codin', '$PROJECT', '$MODULE',
    881, '$REPOSITORY', '$CHECKOUT', '$BRANCH', 'main', '$BASE_COMMIT', 'active', 0,
    '2026-08-30T00:00:00+00:00', '2026-08-30T00:00:00+00:00'
);

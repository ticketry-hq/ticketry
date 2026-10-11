//! Stage-skill availability for a launch binding being configured (CODING-2722).
//!
//! The provider comes from the same agent → profile → global-default order a
//! task launch uses, and the module-relative roots come from the Module's
//! typed link. Every case uses a disposable home and module folder.

use std::fs;
use std::path::{Path, PathBuf};

use sea_orm::{ConnectionTrait, Database, DatabaseConnection};
use ticketry_provider::{Provider, SkillAvailabilityStatus, SkillSearchEnvironment};
use ticketry_work_management::{
    check_launch_skill_availability, LaunchSkillAvailability, LaunchSkillAvailabilityRequest,
};

const MODULE: &str = "50000000000000000000000000000000";
const UNLINKED: &str = "50000000000000000000000000000001";

struct Fixture {
    _directory: tempfile::TempDir,
    database: DatabaseConnection,
    home: PathBuf,
    module: PathBuf,
}

async fn fixture(global_default: &str) -> Fixture {
    let directory = tempfile::tempdir().unwrap();
    let home = directory.path().join("home");
    let module = directory.path().join("module");
    fs::create_dir_all(&home).unwrap();
    fs::create_dir_all(&module).unwrap();
    let path = directory.path().join("state.db");
    let database = Database::connect(format!("sqlite:{}?mode=rwc", path.display()))
        .await
        .unwrap();
    database
        .execute_unprepared(&format!(
            r#"CREATE TABLE app_settings (
                scope varchar NOT NULL, "key" varchar NOT NULL,
                value varchar NOT NULL, updated_at varchar NOT NULL,
                PRIMARY KEY(scope, "key")
            );
            INSERT INTO app_settings VALUES
                ('host', 'provider_catalog', '{global_default}', CURRENT_TIMESTAMP);
            CREATE TABLE worktracker_issue (
                sprint_id char(32) NULL, id char(32) PRIMARY KEY, project_id char(32) NOT NULL,
                type varchar(10) NOT NULL, issue_type_id char(32) NOT NULL,
                parent_id char(32), module_id char(32), state_id char(32),
                state_revision bigint NOT NULL, name varchar(512) NOT NULL,
                sequence_id integer NOT NULL, is_archived bool NOT NULL,
                rank varchar(64) NOT NULL, description text NOT NULL,
                workspace_tab_order text NOT NULL DEFAULT '[]',
                created_at datetime NOT NULL, updated_at datetime NOT NULL
            );
            INSERT INTO worktracker_issue VALUES
                (NULL, '{MODULE}', 'p', 'module', 't', NULL, NULL, NULL, 0, 'Module', 1, 0,
                 'a', '', '[]', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
                (NULL, '{UNLINKED}', 'p', 'module', 't', NULL, NULL, NULL, 0, 'Other', 2, 0,
                 'b', '', '[]', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);"#
        ))
        .await
        .unwrap();
    ticketry_work_management::install_module_links_schema(&database)
        .await
        .unwrap();
    ticketry_work_management::ModuleLinkStore::new(database.clone())
        .set(MODULE, &module.display().to_string())
        .await
        .unwrap();
    Fixture {
        _directory: directory,
        database,
        home,
        module,
    }
}

impl Fixture {
    async fn check(
        &self,
        module_id: &str,
        agent: Option<&str>,
        profile: Option<&str>,
        names: &[&str],
    ) -> LaunchSkillAvailability {
        check_launch_skill_availability(
            &self.database,
            &LaunchSkillAvailabilityRequest {
                module_id: module_id.to_owned(),
                agent: agent.map(str::to_owned),
                profile: profile.map(str::to_owned),
                names: names.iter().map(|name| (*name).to_owned()).collect(),
            },
            &SkillSearchEnvironment {
                home: Some(self.home.clone()),
                ..SkillSearchEnvironment::default()
            },
        )
        .await
    }
}

fn install(root: &Path, name: &str) {
    fs::create_dir_all(root.join(name)).unwrap();
    fs::write(root.join(name).join("SKILL.md"), "# skill\n").unwrap();
}

fn checked(result: LaunchSkillAvailability) -> ticketry_provider::SkillAvailabilityReport {
    match result {
        LaunchSkillAvailability::Checked(report) => report,
        other => panic!("expected a checked report, got {other:?}"),
    }
}

const CLAUDE_DEFAULT: &str = r#"{"global_default":{"provider":"claude"}}"#;

#[tokio::test]
async fn an_explicit_agent_is_checked_against_its_own_roots_in_the_linked_module() {
    let fixture = fixture(CLAUDE_DEFAULT).await;
    install(&fixture.module.join("skills"), "grill-with-docs");
    install(&fixture.home.join(".claude/skills"), "tdd");

    let report = checked(
        fixture
            .check(MODULE, Some("codex"), None, &["grill-with-docs", "tdd"])
            .await,
    );

    assert_eq!(report.provider, Provider::Codex);
    assert!(report
        .searched_roots
        .contains(&fixture.module.join("skills")));
    assert_eq!(report.skills[0].status, SkillAvailabilityStatus::Available);
    assert_eq!(report.skills[1].status, SkillAvailabilityStatus::Missing);
}

#[tokio::test]
async fn a_binding_without_an_agent_uses_the_profile_and_then_the_global_default() {
    let fixture = fixture(CLAUDE_DEFAULT).await;

    let inherited = checked(fixture.check(MODULE, None, None, &[]).await);
    let profiled = checked(fixture.check(MODULE, None, Some("deep"), &[]).await);

    assert_eq!(inherited.provider, Provider::Claude);
    assert_eq!(profiled.provider, Provider::Codex);
}

#[tokio::test]
async fn an_unresolved_or_unknown_provider_is_never_reported_as_checked() {
    let fixture = fixture(r#"{"global_default":null}"#).await;

    let unresolved = fixture.check(MODULE, None, None, &["tdd"]).await;
    let unknown = fixture.check(MODULE, Some("mystery"), None, &["tdd"]).await;

    assert!(matches!(
        unresolved,
        LaunchSkillAvailability::Unchecked {
            code: "agent_not_configured",
            ..
        }
    ));
    assert!(matches!(
        unknown,
        LaunchSkillAvailability::Unchecked {
            code: "unknown_agent",
            ..
        }
    ));
}

#[tokio::test]
async fn an_unlinked_module_folder_leaves_the_names_unchecked() {
    let fixture = fixture(CLAUDE_DEFAULT).await;

    let result = fixture
        .check(UNLINKED, Some("claude"), None, &["tdd"])
        .await;

    match result {
        LaunchSkillAvailability::Unchecked {
            code,
            provider,
            message,
        } => {
            assert_eq!(code, "module_link_not_found");
            assert_eq!(provider, Some(Provider::Claude));
            assert_eq!(message, "No local folder is linked to this module.");
        }
        other => panic!("expected unchecked, got {other:?}"),
    }
}

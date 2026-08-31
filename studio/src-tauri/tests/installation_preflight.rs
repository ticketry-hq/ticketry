//! A structurally valid installation is also proven meaningful, or refused.
//!
//! The corpus these cases run against is built from Ticketry's real migrations,
//! so "every supported installation passes preflight" is evidence about the
//! databases users actually have. The refusal cases are made by mutating a copy
//! of a real fixture, which is how a defect gets into a database whose schema
//! still classifies: exactly the situation preflight exists for.

mod common;

use std::path::Path;

use common::installation_corpus as corpus;
use muxed_studio_lib::installation::classification::{self as classification, Installation};
use muxed_studio_lib::installation::preflight::{
    self as preflight, Area, PreflightFailure, PreflightReport, Verdict,
};

/// Classify and preflight one installation, expecting both to complete.
async fn run(data_directory: &Path) -> PreflightReport {
    let classified = classification::classify(data_directory)
        .await
        .expect("the fixture must classify");
    preflight::preflight(data_directory, &classified)
        .await
        .expect("preflight must complete")
}

/// Preflight an installation whose schema classified before it was mutated.
async fn run_as(data_directory: &Path, classified: &Installation) -> PreflightReport {
    preflight::preflight(data_directory, classified)
        .await
        .expect("preflight must complete")
}

fn defect<'report>(report: &'report PreflightReport, code: &str) -> &'report preflight::Defect {
    report
        .defects
        .iter()
        .find(|defect| defect.code == code)
        .unwrap_or_else(|| {
            panic!(
                "{code} was not reported; found {:?}",
                report
                    .defects
                    .iter()
                    .map(|defect| defect.code.as_str())
                    .collect::<Vec<_>>()
            )
        })
}

#[tokio::test]
async fn every_corpus_fixture_is_semantically_adoptable() {
    // Every generation Ticketry supports must pass every rule that applies to
    // it. A rule too strict for a real installation fails here rather than
    // refusing a user's only working database after release.
    for fixture in &classification::manifest().corpus {
        let installation = corpus::install(&fixture.name);
        let report = run(installation.path()).await;
        assert_eq!(
            report.verdict(),
            Verdict::Adoptable,
            "{} must be adoptable, but reported {:#?}",
            fixture.name,
            report.defects
        );
        assert!(report.checked > 0, "{} ran no rules at all", fixture.name);
    }
}

#[tokio::test]
async fn a_historical_generation_records_the_rules_it_has_no_table_for() {
    // A rule that cannot run must say so. Without that, a clean report on an
    // early generation would be indistinguishable from a report where half the
    // rules silently did nothing.
    let installation = corpus::install("django-worktracker-0001_initial");
    let report = run(installation.path()).await;

    assert!(
        !report.skipped.is_empty(),
        "an early generation carries none of the later capability tables"
    );
    for skipped in &report.skipped {
        let table = skipped
            .missing_requirement
            .split('.')
            .next()
            .expect("a requirement names a table");
        assert!(
            !std::path::Path::new(table).exists(),
            "a requirement must name a table, not a path"
        );
    }
    assert!(
        report
            .skipped
            .iter()
            .any(|skipped| skipped.missing_requirement.starts_with("worktrees")),
        "the initial generation has no worktrees table"
    );
}

#[tokio::test]
async fn the_current_generation_runs_every_rule_its_schema_can_answer() {
    let installation = corpus::install("current-representative");
    let report = run(installation.path()).await;

    // The only rules a current Django installation cannot answer are the ones
    // about tables Rust itself introduces during adoption — the status-event
    // ledger, the launch and cleanup effect journals, and the reconciliation
    // journal. Those rules exist for reopening an installation Rust already
    // owns, which is the other input this preflight has to cover.
    let rust_owned = [
        "runs_status_events",
        "runs_project_compaction_watermarks",
        "runs_launch_effects",
        "terminal_cleanup_effects",
        "workspace_operations",
    ];
    for skipped in &report.skipped {
        assert!(
            rust_owned
                .iter()
                .any(|table| skipped.missing_requirement.starts_with(table)),
            "{} was skipped on the current generation",
            skipped.code
        );
    }
    assert!(report.checked > 80, "only {} rules ran", report.checked);
}

#[tokio::test]
async fn an_empty_installation_has_nothing_to_check() {
    let directory = tempfile::tempdir().expect("an empty data directory");
    let report = run(directory.path()).await;

    assert_eq!(report.verdict(), Verdict::Adoptable);
    assert_eq!(report.checked, 0);
    assert!(
        corpus::directory_entries(directory.path()).is_empty(),
        "preflighting an empty installation must not provision anything"
    );
}

#[tokio::test]
async fn a_postgresql_source_is_preflighted_by_the_import_that_can_read_it() {
    let directory = tempfile::tempdir().expect("a data directory");
    std::fs::write(directory.path().join("database-url.enabled"), b"1").expect("stage the gate");
    std::fs::write(
        directory.path().join("database-url"),
        b"postgresql://user:hunter2@localhost/ticketry",
    )
    .expect("stage the marker");

    let classified = classification::classify(directory.path())
        .await
        .expect("a PostgreSQL source classifies");
    let error = preflight::preflight(directory.path(), &classified)
        .await
        .expect_err("these checks cannot read PostgreSQL");

    assert_eq!(error.failure(), PreflightFailure::EngineNotInspectable);
    assert!(
        !error.detail().contains("hunter2"),
        "a refusal must not carry a credential"
    );
}

// --------------------------------------------------------------------------
// Work Management defects
// --------------------------------------------------------------------------

#[tokio::test]
async fn a_parent_cycle_is_refused_with_its_affected_identities() {
    let installation = corpus::install("current-representative");
    // The module becomes its own child's child, which is a planning tree with
    // no root: every walk over it runs forever.
    corpus::execute(
        installation.path(),
        "UPDATE worktracker_issue
         SET parent_id = '00000000000000000000000000098606'
         WHERE id = '00000000000000000000000000098605'",
    )
    .await;

    let report = run(installation.path()).await;

    assert_eq!(report.verdict(), Verdict::Refused);
    let cycle = defect(&report, "work-item-ancestry-cycle");
    assert_eq!(cycle.area, Area::WorkManagement);
    assert_eq!(cycle.count, 2, "both work items are on the loop");
    assert!(cycle
        .affected
        .contains(&"00000000000000000000000000098605".to_owned()));
    assert!(!cycle.is_admitted(), "no bridge admits an unknown defect");
}

#[tokio::test]
async fn a_blocker_cycle_is_refused() {
    let installation = corpus::install("current-representative");
    corpus::execute(
        installation.path(),
        "INSERT INTO worktracker_issue_blocked_by (from_issue_id, to_issue_id) VALUES
           ('00000000000000000000000000098605', '00000000000000000000000000098606'),
           ('00000000000000000000000000098606', '00000000000000000000000000098605')",
    )
    .await;

    let report = run(installation.path()).await;

    assert_eq!(report.verdict(), Verdict::Refused);
    assert_eq!(defect(&report, "blocker-cycle").count, 2);
}

#[tokio::test]
async fn a_duplicate_human_key_is_refused() {
    let installation = corpus::install("current-representative");
    let classified = classification::classify(installation.path())
        .await
        .expect("the fixture classifies before it is mutated");
    // Today's schema carries a unique index over the key, so a duplicate can
    // only have arrived from a generation that had none — which is the exact
    // input this rule exists to catch on the way in. Removing the index
    // reproduces that database rather than one today's writer could create.
    corpus::execute_unconstrained(
        installation.path(),
        "DROP INDEX worktracker_issue_project_id_sequence_id_55f38730_uniq;
         UPDATE worktracker_issue SET sequence_id = 1
         WHERE id = '00000000000000000000000000098606'",
    )
    .await;

    let report = run_as(installation.path(), &classified).await;

    assert_eq!(report.verdict(), Verdict::Refused);
    assert_eq!(defect(&report, "work-item-sequence-duplicate").count, 2);
}

#[tokio::test]
async fn a_sequence_counter_that_would_reissue_a_key_is_refused() {
    let installation = corpus::install("current-representative");
    corpus::execute(
        installation.path(),
        "UPDATE worktracker_project SET seq_counter = 0",
    )
    .await;

    let report = run(installation.path()).await;

    assert_eq!(report.verdict(), Verdict::Refused);
    assert_eq!(defect(&report, "project-sequence-counter-behind").count, 1);
}

#[tokio::test]
async fn a_state_outside_its_own_workflow_is_refused() {
    let installation = corpus::install("current-representative");
    corpus::execute(
        installation.path(),
        "INSERT INTO worktracker_state
           (id, project_id, name, \"group\", color, sort_order, is_protected,
            created_at, updated_at)
         VALUES ('00000000000000000000000000098610',
                 '00000000000000000000000000098601', 'Orphan', 'started', '', 9, 0,
                 '2026-08-22 09:00:00', '2026-08-22 09:00:00');
         UPDATE worktracker_issue SET state_id = '00000000000000000000000000098610'
         WHERE id = '00000000000000000000000000098606'",
    )
    .await;

    let report = run(installation.path()).await;

    assert_eq!(report.verdict(), Verdict::Refused);
    assert_eq!(defect(&report, "work-item-state-outside-workflow").count, 1);
}

#[tokio::test]
async fn an_unreadable_rank_is_refused() {
    let installation = corpus::install("current-representative");
    corpus::execute(
        installation.path(),
        "UPDATE worktracker_issue SET rank = 'a b'
         WHERE id = '00000000000000000000000000098606'",
    )
    .await;

    let report = run(installation.path()).await;

    assert_eq!(report.verdict(), Verdict::Refused);
    assert_eq!(defect(&report, "work-item-rank-syntax").count, 1);
}

#[tokio::test]
async fn an_empty_legacy_module_rank_is_not_a_work_item_rank_defect() {
    let installation = corpus::install("current-representative");
    corpus::execute(
        installation.path(),
        "UPDATE worktracker_issue SET rank = '' WHERE \"type\" = 'module'",
    )
    .await;

    let report = run(installation.path()).await;

    assert_eq!(report.verdict(), Verdict::Adoptable);
    assert!(report
        .defects
        .iter()
        .all(|defect| defect.code != "work-item-rank-syntax"));
}

#[tokio::test]
async fn a_work_item_whose_kind_contradicts_its_issue_type_is_refused() {
    let installation = corpus::install("current-representative");
    corpus::execute(
        installation.path(),
        "UPDATE worktracker_issue
         SET issue_type_id = '00000000000000000000000000098603'
         WHERE id = '00000000000000000000000000098606'",
    )
    .await;

    let report = run(installation.path()).await;

    assert_eq!(report.verdict(), Verdict::Refused);
    assert_eq!(
        defect(&report, "work-item-issue-type-level-mismatch").count,
        1
    );
}

// --------------------------------------------------------------------------
// Capability and effect-history defects
// --------------------------------------------------------------------------

#[tokio::test]
async fn a_document_pointing_at_a_missing_work_item_is_refused() {
    let installation = corpus::install("current-representative");
    corpus::execute(
        installation.path(),
        "UPDATE design_documents SET task_id = '00000000000000000000000000099999'",
    )
    .await;

    let report = run(installation.path()).await;

    assert_eq!(report.verdict(), Verdict::Refused);
    assert_eq!(defect(&report, "document-work-item-missing").count, 1);
}

#[tokio::test]
async fn a_worktree_in_an_unknown_operation_state_is_refused() {
    let installation = corpus::install("current-representative");
    corpus::execute(
        installation.path(),
        "UPDATE worktrees SET status = 'half-integrated'",
    )
    .await;

    let report = run(installation.path()).await;

    assert_eq!(report.verdict(), Verdict::Refused);
    assert_eq!(defect(&report, "worktree-operation-state-unknown").count, 1);
}

#[tokio::test]
async fn a_run_that_ended_before_it_started_is_refused() {
    let installation = corpus::install("current-representative");
    corpus::execute(
        installation.path(),
        "UPDATE agent_runs SET ended_at = '2026-08-21 09:00:00'",
    )
    .await;

    let report = run(installation.path()).await;

    assert_eq!(report.verdict(), Verdict::Refused);
    assert_eq!(defect(&report, "run-ended-before-started").count, 1);
}

#[tokio::test]
async fn a_launch_claim_without_its_graph_run_is_refused() {
    let installation = corpus::install("current-representative");
    corpus::execute(
        installation.path(),
        "INSERT INTO launched_tasks (task_id, root_id, agent_run_id, launched_at)
         VALUES ('00000000000000000000000000098606',
                 '00000000000000000000000000098605',
                 'corpus-run', '2026-08-22 09:10:00')",
    )
    .await;

    let report = run(installation.path()).await;

    assert_eq!(report.verdict(), Verdict::Refused);
    let claim = defect(&report, "launch-claim-graph-missing");
    assert_eq!(claim.area, Area::Capability);
    assert_eq!(claim.count, 1);
}

#[tokio::test]
async fn a_terminal_launch_whose_environment_is_not_an_object_is_refused() {
    let installation = corpus::install("current-representative");
    corpus::execute_unconstrained(
        installation.path(),
        "INSERT INTO terminal_launch_requests
           (effect_id, agent_run_id, issue_id, project_id, module_id, task_id, scope,
            command, working_directory, environment, \"columns\", \"rows\", created_at)
         VALUES ('effect-1', 'corpus-run',
                 '00000000000000000000000000098606',
                 '00000000000000000000000000098601',
                 '00000000000000000000000000098605',
                 '00000000000000000000000000098606', 'task',
                 'codex --dangerously-bypass-approvals', '/tmp',
                 'ANTHROPIC_API_KEY=sk-live-should-never-be-reported', 80, 24,
                 '2026-08-22 09:00:00')",
    )
    .await;

    let report = run(installation.path()).await;

    assert_eq!(report.verdict(), Verdict::Refused);
    let malformed = defect(&report, "terminal-launch-request-environment-malformed");
    assert_eq!(malformed.area, Area::EffectHistory);
    assert_eq!(malformed.affected, ["effect-1"]);
}

#[tokio::test]
async fn a_declared_foreign_key_with_no_parent_row_is_refused() {
    let installation = corpus::install("current-representative");
    // Django wrote this table with foreign keys declared but not enforced, so a
    // dangling reference is exactly what a real defective installation holds.
    corpus::execute_unconstrained(
        installation.path(),
        "UPDATE agent_runs SET issue_id = '00000000000000000000000000099999'",
    )
    .await;

    let report = run(installation.path()).await;

    assert_eq!(report.verdict(), Verdict::Refused);
    let structural = defect(&report, "foreign-key-violation");
    assert_eq!(structural.area, Area::Structure);
    assert_eq!(structural.count, 1);
    // The semantic rule names the row by its own identity, which is what makes
    // the report actionable where the storage-level check names a rowid.
    assert_eq!(
        defect(&report, "run-work-item-missing").affected,
        ["corpus-run"]
    );
}

// --------------------------------------------------------------------------
// Filesystem and runtime authority
// --------------------------------------------------------------------------

#[tokio::test]
async fn a_document_path_leaving_its_root_is_refused_without_naming_the_path() {
    let installation = corpus::install("current-representative");
    corpus::execute(
        installation.path(),
        "UPDATE design_documents SET rel_path = '../../../../etc/ssh/sshd_config'",
    )
    .await;

    let report = run(installation.path()).await;

    assert_eq!(report.verdict(), Verdict::Refused);
    let escape = defect(&report, "path-escapes-its-root");
    assert_eq!(escape.area, Area::Filesystem);
    assert_eq!(escape.count, 1);
    let rendered = report.render();
    assert!(
        !rendered.contains("sshd_config") && !rendered.contains(".."),
        "a report must not reproduce the offending path: {rendered}"
    );
    assert!(
        escape.affected[0].contains("@path:"),
        "the row is reported with a path digest, not a path"
    );
}

#[tokio::test]
async fn an_attachment_recorded_as_an_absolute_path_is_refused() {
    let installation = corpus::install("current-representative");
    corpus::execute(
        installation.path(),
        "INSERT INTO worktracker_attachment
           (id, issue_id, file, filename, mime_type, size, created_at)
         VALUES ('00000000000000000000000000098620',
                 '00000000000000000000000000098606',
                 '/etc/shadow', 'shadow', 'text/plain', 1, '2026-08-22 09:00:00')",
    )
    .await;

    let report = run(installation.path()).await;

    assert_eq!(report.verdict(), Verdict::Refused);
    assert_eq!(defect(&report, "path-unexpectedly-absolute").count, 1);
}

#[tokio::test]
async fn a_media_root_linked_out_of_the_data_directory_is_refused() {
    let installation = corpus::install("current-representative");
    let outside = tempfile::tempdir().expect("a directory outside the installation");
    let media = installation.path().join("media");
    std::fs::remove_dir_all(&media).expect("clear the real media root");
    std::os::unix::fs::symlink(outside.path(), &media).expect("link the media root out");

    let report = run(installation.path()).await;

    assert_eq!(report.verdict(), Verdict::Refused);
    let escape = defect(&report, "path-symlink-escapes-allowed-root");
    assert_eq!(escape.affected, ["data-directory/media"]);
}

#[tokio::test]
async fn an_unsafe_tmux_session_name_is_refused_before_it_reaches_a_command_line() {
    let installation = corpus::install("current-representative");
    corpus::execute(
        installation.path(),
        "INSERT INTO agent_terminal_sessions
           (agent_run_id, tmux_session_name, task_id, module_id, project_id,
            created_at, scope, runtime_cleanup_pending, output_sequence)
         VALUES ('corpus-run', 'pt-corpus-run:0.1',
                 '00000000000000000000000000098606',
                 '00000000000000000000000000098605',
                 '00000000000000000000000000098601',
                 '2026-08-22 09:00:00', 'task', 0, 0)",
    )
    .await;

    let report = run(installation.path()).await;

    assert_eq!(report.verdict(), Verdict::Refused);
    let unsafe_name = defect(&report, "tmux-session-name-unsafe");
    assert_eq!(unsafe_name.area, Area::Runtime);
    assert_eq!(unsafe_name.affected, ["corpus-run"]);
}

#[tokio::test]
async fn an_unsafe_runtime_namespace_is_refused() {
    let installation = corpus::install("current-representative");
    corpus::execute(
        installation.path(),
        "INSERT INTO agent_terminal_sessions
           (agent_run_id, tmux_session_name, task_id, module_id, project_id,
            created_at, scope, runtime_cleanup_pending, output_sequence,
            runtime_namespace)
         VALUES ('corpus-run', 'pt-corpus-run',
                 '00000000000000000000000000098606',
                 '00000000000000000000000000098605',
                 '00000000000000000000000000098601',
                 '2026-08-22 09:00:00', 'task', 0, 0, '../escape')",
    )
    .await;

    let report = run(installation.path()).await;

    assert_eq!(report.verdict(), Verdict::Refused);
    assert_eq!(defect(&report, "runtime-namespace-unsafe").count, 1);
}

// --------------------------------------------------------------------------
// Integrity, disclosure, and effect
// --------------------------------------------------------------------------

#[tokio::test]
async fn a_corrupt_database_is_refused_before_any_semantic_answer_is_trusted() {
    let installation = corpus::install("current-small");
    let classified = classification::classify(installation.path())
        .await
        .expect("the fixture classifies before it is damaged");
    corrupt_a_content_page(&installation.path().join("state.db"));

    let report = run_as(installation.path(), &classified).await;

    assert_eq!(report.verdict(), Verdict::Refused);
    let integrity = defect(&report, "sqlite-integrity");
    assert_eq!(integrity.area, Area::Structure);
    assert!(integrity.count > 0);
}

#[tokio::test]
async fn a_report_carries_identities_and_counts_and_no_secret() {
    let installation = corpus::install("current-representative");
    // Every kind of value a report must never carry, in one installation, each
    // on a row that also breaks a rule.
    corpus::execute_unconstrained(
        installation.path(),
        "UPDATE worktracker_launchbinding
           SET prompt = 'PROMPT-SECRET', required_skills = 'not-json';
         UPDATE agent_runs SET cwd = 'relative/CWD-SECRET';
         UPDATE design_documents SET rel_path = '../ROOT-SECRET/SPEC.md';
         INSERT INTO app_settings (scope, key, value, updated_at)
           VALUES ('provider', 'apiKey', 'sk-live-SETTINGS-SECRET',
                   '2026-08-22 09:00:00');
         INSERT INTO terminal_launch_requests
           (effect_id, agent_run_id, issue_id, project_id, module_id, task_id, scope,
            command, working_directory, environment, \"columns\", \"rows\", created_at)
         VALUES ('effect-secret', 'corpus-run',
                 '00000000000000000000000000098606',
                 '00000000000000000000000000098601',
                 '00000000000000000000000000098605',
                 '00000000000000000000000000098606', 'task',
                 'codex --token COMMAND-SECRET', '/tmp',
                 'ENV-SECRET', 0, 0, '2026-08-22 09:00:00')",
    )
    .await;

    let report = run(installation.path()).await;
    let rendered = report.render();
    let serialized = serde_json::to_string(&report).expect("a report serializes");

    assert_eq!(report.verdict(), Verdict::Refused);
    assert!(report.defects.len() >= 5, "each planted defect is reported");
    for secret in [
        "PROMPT-SECRET",
        "CWD-SECRET",
        "ROOT-SECRET",
        "SETTINGS-SECRET",
        "COMMAND-SECRET",
        "ENV-SECRET",
        "not-json",
    ] {
        assert!(
            !rendered.contains(secret),
            "the rendered report disclosed {secret}"
        );
        assert!(
            !serialized.contains(secret),
            "the serialized report disclosed {secret}"
        );
    }
    // What it does carry: the rule, a count, and stable identities.
    assert!(rendered.contains("settings-value-malformed"));
    assert!(rendered.contains("provider/apiKey"));
}

#[tokio::test]
async fn no_defect_is_admitted_without_a_named_bridge() {
    let installation = corpus::install("current-representative");
    corpus::execute(
        installation.path(),
        "UPDATE worktracker_issue SET rank = '' WHERE \"type\" = 'task'",
    )
    .await;

    let report = run(installation.path()).await;

    assert_eq!(report.verdict(), Verdict::Refused);
    assert!(
        report.required_bridges().is_empty(),
        "an unknown defect must not name a bridge"
    );
    assert!(report.defects.iter().all(|defect| !defect.is_admitted()));
}

#[tokio::test]
async fn a_refused_installation_is_left_byte_for_byte_unchanged() {
    let installation = corpus::install("current-representative");
    corpus::execute(
        installation.path(),
        "UPDATE worktracker_issue SET rank = 'a b'",
    )
    .await;
    let before = corpus::database_bytes(installation.path());
    let entries_before = corpus::directory_entries(installation.path());
    let spool = ticketry_runs::hook_spool::hook_spool_directory(installation.path());

    let report = run(installation.path()).await;

    assert!(report.refuses());
    corpus::assert_stored_bytes_unchanged(installation.path(), &before, "preflighting");
    corpus::assert_no_new_durable_artifact(installation.path(), &entries_before, "preflight");
    assert!(
        !spool.exists(),
        "preflight must not create the hook spool it inspects"
    );
}

#[tokio::test]
async fn an_accepted_installation_is_also_left_unchanged() {
    // A pending write-ahead log is the case where a reader is most likely to
    // change the stored bytes: the checks must read the log as committed content
    // without checkpointing it.
    let installation = corpus::install("current-wal");
    let before = corpus::database_bytes(installation.path());
    let entries_before = corpus::directory_entries(installation.path());

    let report = run(installation.path()).await;

    assert_eq!(report.verdict(), Verdict::Adoptable);
    corpus::assert_stored_bytes_unchanged(installation.path(), &before, "preflighting");
    corpus::assert_no_new_durable_artifact(installation.path(), &entries_before, "preflight");
}

#[tokio::test]
async fn preflight_is_repeatable_and_produces_the_same_report() {
    let installation = corpus::install("current-representative");
    corpus::execute(
        installation.path(),
        "UPDATE worktrees SET status = 'unknown-state'",
    )
    .await;

    let first = run(installation.path()).await;
    let second = run(installation.path()).await;

    assert_eq!(first, second, "a report must be stable across runs");
}

/// Overwrite the interior of a content page so SQLite's own check fails.
///
/// The first page holds the schema, so it is left intact: the point of the case
/// is a database that still classifies and still opens, whose *rows* cannot be
/// trusted. That is the input a semantic-only preflight would answer cleanly and
/// wrongly.
fn corrupt_a_content_page(database: &Path) {
    let mut bytes = std::fs::read(database).expect("read the fixture database");
    let page_size = usize::from(u16::from_be_bytes([bytes[16], bytes[17]]));
    let page_size = if page_size == 1 { 65_536 } else { page_size };
    assert!(
        bytes.len() > page_size * 2,
        "the fixture must have a content page to damage"
    );
    let start = bytes.len() - page_size + 16;
    for byte in &mut bytes[start..start + 64] {
        *byte = 0xA5;
    }
    std::fs::write(database, bytes).expect("store the damaged database");
}

// --------------------------------------------------------------------------
// Reopening an installation Rust already owns
// --------------------------------------------------------------------------

/// Hand the whole installation over to Rust, the way startup does.
///
/// Reopening is the second input preflight has to cover: after the first
/// launch, every subsequent one preflights a Rust-owned database whose
/// status-event ledger and effect journals a Django-era source never had.
async fn adopt_every_capability(data_directory: &Path) {
    ticketry_work_management::work_management::adoption::adopt(data_directory)
        .await
        .expect("adopt Work Management");
    ticketry_runs::persistence::adopt(data_directory)
        .await
        .expect("adopt Runs");
    ticketry_agent_execution::execution::persistence::adopt(data_directory)
        .await
        .expect("adopt graph execution");
    ticketry_terminal::terminal::persistence::adopt(data_directory)
        .await
        .expect("adopt terminals");
}

#[tokio::test]
async fn a_rust_owned_installation_is_preflighted_through_its_own_journals() {
    let installation = corpus::install("current-representative");
    adopt_every_capability(installation.path()).await;

    let report = run(installation.path()).await;

    assert_eq!(
        report.verdict(),
        Verdict::Adoptable,
        "an adopted installation must reopen cleanly, but reported {:#?}",
        report.defects
    );
    // The rules a Django source cannot answer are exactly the ones that now do.
    for skipped in &report.skipped {
        assert!(
            !skipped
                .missing_requirement
                .starts_with("runs_status_events"),
            "the status-event ledger exists after adoption"
        );
    }
}

#[tokio::test]
async fn an_inconsistent_effect_journal_in_a_rust_owned_installation_is_refused() {
    let installation = corpus::install("current-representative");
    adopt_every_capability(installation.path()).await;
    let classified = classification::classify(installation.path())
        .await
        .expect("an adopted installation classifies");
    // A launch effect claiming to be leased with no lease owner is a crash
    // signature reconciliation cannot resolve: it can neither wait for the owner
    // nor take the lease itself.
    corpus::execute_unconstrained(
        installation.path(),
        "INSERT INTO runs_launch_effects
           (effect_id, agent_run_id, request_id, project_id, issue_id, scope,
            target_kind, target_id, state, lease_owner, lease_expires_at)
         VALUES ('e0000000000000000000000000000009', 'corpus-run',
                 'graph-adopted:corpus', '00000000000000000000000000098601',
                 '00000000000000000000000000098606', 'task', 'automation',
                 '00000000000000000000000000098606', 'leased', NULL, NULL)",
    )
    .await;

    let report = run_as(installation.path(), &classified).await;

    assert_eq!(report.verdict(), Verdict::Refused);
    let inconsistent = defect(&report, "launch-effect-lease-inconsistent");
    assert_eq!(inconsistent.area, Area::EffectHistory);
    assert!(inconsistent.count > 0);
}

#[tokio::test]
async fn a_malformed_status_event_payload_is_refused() {
    let installation = corpus::install("current-representative");
    adopt_every_capability(installation.path()).await;
    let classified = classification::classify(installation.path())
        .await
        .expect("an adopted installation classifies");
    corpus::execute_unconstrained(
        installation.path(),
        "INSERT INTO runs_status_events
           (event_id, project_id, event_kind, payload_version, subject_kind,
            subject_id, payload, committed_at)
         VALUES ('e0000000000000000000000000000001',
                 '00000000000000000000000000098601', 'run.updated', 1,
                 'agent-run', 'corpus-run', 'not-json', '2026-08-22 09:00:00')",
    )
    .await;

    let report = run_as(installation.path(), &classified).await;

    assert_eq!(report.verdict(), Verdict::Refused);
    assert_eq!(
        defect(&report, "status-event-payload-malformed").affected,
        ["e0000000000000000000000000000001"]
    );
}

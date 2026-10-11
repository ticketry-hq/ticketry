//! The read-only skill availability contract (CODING-2722).
//!
//! Every case builds a disposable home and working directory and passes an
//! explicit search environment, so no test reads or mutates the real HOME,
//! CLAUDE_CONFIG_DIR, CODEX_HOME or GEMINI_CLI_HOME.

use std::fs;
use std::path::{Path, PathBuf};

use ticketry_provider::{
    check_skill_availability, Provider, SkillAvailabilityRequest, SkillAvailabilityStatus,
    SkillSearchEnvironment,
};

struct Fixture {
    _root: tempfile::TempDir,
    home: PathBuf,
    module: PathBuf,
}

impl Fixture {
    fn new() -> Self {
        let root = tempfile::tempdir().unwrap();
        let home = root.path().join("home");
        let module = root.path().join("module");
        fs::create_dir_all(&home).unwrap();
        fs::create_dir_all(&module).unwrap();
        Self {
            _root: root,
            home,
            module,
        }
    }

    fn environment(&self) -> SkillSearchEnvironment {
        SkillSearchEnvironment {
            home: Some(self.home.clone()),
            ..SkillSearchEnvironment::default()
        }
    }

    fn check(
        &self,
        provider: Provider,
        names: &[&str],
    ) -> ticketry_provider::SkillAvailabilityReport {
        self.check_in(provider, names, self.environment())
    }

    fn check_in(
        &self,
        provider: Provider,
        names: &[&str],
        environment: SkillSearchEnvironment,
    ) -> ticketry_provider::SkillAvailabilityReport {
        check_skill_availability(&SkillAvailabilityRequest {
            provider,
            working_root: Some(self.module.clone()),
            names: names.iter().map(|name| (*name).to_owned()).collect(),
            environment,
        })
    }
}

fn install(root: &Path, name: &str) -> PathBuf {
    let directory = root.join(name);
    fs::create_dir_all(&directory).unwrap();
    fs::write(directory.join("SKILL.md"), format!("# {name}\n")).unwrap();
    directory
}

#[test]
fn a_claude_user_skill_with_skill_md_is_available_and_an_empty_folder_is_not() {
    let fixture = Fixture::new();
    let user_root = fixture.home.join(".claude/skills");
    install(&user_root, "tdd");
    fs::create_dir_all(user_root.join("structure-review")).unwrap();

    let report = fixture.check(Provider::Claude, &["tdd", "structure-review"]);

    assert_eq!(
        report.searched_roots,
        vec![fixture.module.join(".claude/skills"), user_root.clone()]
    );
    assert_eq!(report.skills[0].requested, "tdd");
    assert_eq!(report.skills[0].status, SkillAvailabilityStatus::Available);
    assert_eq!(report.skills[0].installed_name.as_deref(), Some("tdd"));
    assert_eq!(
        report.skills[0].location.as_deref(),
        Some(user_root.join("tdd").as_path())
    );
    assert_eq!(report.skills[1].status, SkillAvailabilityStatus::Missing);
    assert_eq!(report.skills[1].installed_name, None);
}

#[test]
fn each_provider_searches_only_its_own_module_and_user_roots_in_order() {
    let fixture = Fixture::new();
    let module = &fixture.module;
    let home = &fixture.home;
    let cases = [
        (
            Provider::Claude,
            vec![module.join(".claude/skills"), home.join(".claude/skills")],
        ),
        (
            Provider::Codex,
            vec![
                module.join(".agents/skills"),
                module.join("skills"),
                home.join(".codex/skills"),
                home.join(".codex/skills/.system"),
            ],
        ),
        (
            Provider::Agy,
            vec![
                module.join(".agents/skills"),
                module.join("skills"),
                home.join(".agy/skills"),
            ],
        ),
        (
            Provider::Gemini,
            vec![module.join(".gemini/skills"), home.join(".gemini/skills")],
        ),
    ];
    for (provider, expected) in cases {
        assert_eq!(
            fixture.check(provider, &[]).searched_roots,
            expected,
            "{provider:?}"
        );
    }
}

#[test]
fn environment_overrides_replace_each_providers_default_base() {
    let fixture = Fixture::new();
    let overrides = fixture.home.join("overrides");
    let environment = SkillSearchEnvironment {
        home: Some(fixture.home.clone()),
        claude_config_dir: Some(overrides.join("claude")),
        codex_home: Some(overrides.join("codex")),
        gemini_cli_home: Some(overrides.join("gemini")),
    };
    let user_roots = |provider| {
        fixture
            .check_in(provider, &[], environment.clone())
            .searched_roots
            .into_iter()
            .filter(|root| root.starts_with(&fixture.home))
            .collect::<Vec<_>>()
    };

    assert_eq!(
        user_roots(Provider::Claude),
        vec![overrides.join("claude/skills")]
    );
    assert_eq!(
        user_roots(Provider::Codex),
        vec![
            overrides.join("codex/skills"),
            overrides.join("codex/skills/.system")
        ]
    );
    assert_eq!(
        user_roots(Provider::Gemini),
        vec![overrides.join("gemini/.gemini/skills")]
    );
    assert_eq!(
        user_roots(Provider::Agy),
        vec![fixture.home.join(".agy/skills")]
    );
}

#[test]
fn codex_sees_system_and_module_skills_but_not_claudes() {
    let fixture = Fixture::new();
    install(&fixture.home.join(".codex/skills/.system"), "skill-creator");
    install(&fixture.module.join("skills"), "grill-with-docs");
    install(&fixture.home.join(".claude/skills"), "structure-review");

    let report = fixture.check(
        Provider::Codex,
        &["skill-creator", "grill-with-docs", "structure-review"],
    );

    let statuses = report
        .skills
        .iter()
        .map(|skill| skill.status.clone())
        .collect::<Vec<_>>();
    assert_eq!(
        statuses,
        vec![
            SkillAvailabilityStatus::Available,
            SkillAvailabilityStatus::Available,
            SkillAvailabilityStatus::Missing,
        ]
    );
    assert!(!report
        .skills
        .iter()
        .any(|skill| skill.installed_name.as_deref() == Some(".system")));
}

#[test]
fn a_symlinked_skill_directory_counts_but_broken_links_and_plain_files_do_not() {
    let fixture = Fixture::new();
    let user_root = fixture.home.join(".claude/skills");
    fs::create_dir_all(&user_root).unwrap();
    let elsewhere = install(&fixture.home.join("shared-skills"), "linked");
    std::os::unix::fs::symlink(&elsewhere, user_root.join("linked")).unwrap();
    std::os::unix::fs::symlink(fixture.home.join("absent"), user_root.join("broken")).unwrap();
    fs::write(user_root.join("plain"), "SKILL.md").unwrap();

    let report = fixture.check(Provider::Claude, &["linked", "broken", "plain"]);

    assert_eq!(report.skills[0].status, SkillAvailabilityStatus::Available);
    assert_eq!(report.skills[0].location, Some(user_root.join("linked")));
    assert_eq!(report.skills[1].status, SkillAvailabilityStatus::Missing);
    assert_eq!(report.skills[2].status, SkillAvailabilityStatus::Missing);
}

#[test]
fn an_exact_match_in_any_root_wins_over_an_earlier_case_only_match() {
    let fixture = Fixture::new();
    install(&fixture.module.join(".claude/skills"), "Interaction-Design");
    let exact = install(&fixture.home.join(".claude/skills"), "interaction-design");

    let report = fixture.check(Provider::Claude, &["interaction-design"]);

    assert_eq!(
        report.skills[0].installed_name.as_deref(),
        Some("interaction-design")
    );
    assert_eq!(report.skills[0].location, Some(exact));
}

#[test]
fn a_case_only_match_is_available_under_the_installed_spelling_chosen_deterministically() {
    let fixture = Fixture::new();
    let module_root = fixture.module.join(".claude/skills");
    install(&module_root, "INTERACTION-DESIGN");
    install(&fixture.home.join(".claude/skills"), "interaction-DESIGN");

    for _ in 0..3 {
        let report = fixture.check(Provider::Claude, &["Interaction-design"]);
        let skill = &report.skills[0];
        assert_eq!(skill.requested, "Interaction-design");
        assert_eq!(skill.status, SkillAvailabilityStatus::Available);
        // Among case-only matches the first searched root wins.
        assert_eq!(skill.installed_name.as_deref(), Some("INTERACTION-DESIGN"));
        assert_eq!(skill.location, Some(module_root.join("INTERACTION-DESIGN")));
    }
}

#[test]
fn the_story_review_names_report_one_case_only_match_and_one_missing_skill() {
    let fixture = Fixture::new();
    install(&fixture.home.join(".codex/skills"), "interaction-design");

    let report = fixture.check(Provider::Codex, &["Interaction-design", "structure-review"]);

    assert_eq!(report.skills[0].status, SkillAvailabilityStatus::Available);
    assert_eq!(
        report.skills[0].installed_name.as_deref(),
        Some("interaction-design")
    );
    assert_eq!(report.skills[1].status, SkillAvailabilityStatus::Missing);
}

#[test]
fn an_unreadable_root_leaves_unfound_skills_unchecked_rather_than_missing() {
    use std::os::unix::fs::PermissionsExt;
    let fixture = Fixture::new();
    let locked = fixture.module.join(".claude/skills");
    fs::create_dir_all(&locked).unwrap();
    install(&fixture.home.join(".claude/skills"), "tdd");
    fs::set_permissions(&locked, fs::Permissions::from_mode(0o000)).unwrap();
    if fs::read_dir(&locked).is_ok() {
        // Running as root ignores permissions; the case cannot be observed.
        fs::set_permissions(&locked, fs::Permissions::from_mode(0o755)).unwrap();
        return;
    }

    let report = fixture.check(Provider::Claude, &["tdd", "structure-review"]);
    fs::set_permissions(&locked, fs::Permissions::from_mode(0o755)).unwrap();

    assert_eq!(report.skills[0].status, SkillAvailabilityStatus::Available);
    match &report.skills[1].status {
        SkillAvailabilityStatus::Unchecked { reason } => {
            assert!(reason.contains(&locked.display().to_string()), "{reason}")
        }
        other => panic!("expected unchecked, got {other:?}"),
    }
    assert_eq!(report.skills[1].installed_name, None);
}

#[test]
fn checking_never_writes_to_any_skill_tree() {
    let fixture = Fixture::new();
    install(&fixture.home.join(".codex/skills"), "tdd");
    install(&fixture.home.join(".codex/skills/.system"), "skill-creator");
    install(&fixture.module.join(".agents/skills"), "Grill");
    fs::create_dir_all(fixture.home.join(".claude/skills/empty")).unwrap();
    let before = snapshot(fixture._root.path());

    for provider in Provider::ALL {
        let _ = fixture.check(
            provider,
            &["tdd", "grill", "missing", "../escape", ".system"],
        );
    }

    assert_eq!(snapshot(fixture._root.path()), before);
}

fn snapshot(root: &Path) -> Vec<(PathBuf, Option<Vec<u8>>, std::time::SystemTime)> {
    let mut entries = Vec::new();
    let mut pending = vec![root.to_path_buf()];
    while let Some(path) = pending.pop() {
        let metadata = fs::symlink_metadata(&path).unwrap();
        let contents = metadata.is_file().then(|| fs::read(&path).unwrap());
        entries.push((path.clone(), contents, metadata.modified().unwrap()));
        if metadata.is_dir() {
            for child in fs::read_dir(&path).unwrap() {
                pending.push(child.unwrap().path());
            }
        }
    }
    entries.sort_by(|left, right| left.0.cmp(&right.0));
    entries
}

#[cfg(unix)]
#[test]
fn unreadable_skill_metadata_is_unchecked_without_hiding_readable_matches() {
    use std::os::unix::fs::PermissionsExt;
    let fixture = Fixture::new();
    let root = fixture.module.join(".claude/skills");
    let locked = install(&root, "structure-review");
    let readable = install(&root, "tdd");
    fs::set_permissions(&locked, fs::Permissions::from_mode(0o000)).unwrap();
    if fs::metadata(locked.join("SKILL.md")).is_ok() {
        // A privileged runner can bypass Unix permissions, as in the root-read
        // case above; restore the fixture and report that limitation explicitly.
        fs::set_permissions(&locked, fs::Permissions::from_mode(0o755)).unwrap();
        eprintln!("Permission-denied metadata case is unobservable for this privileged runner.");
        return;
    }
    let report = fixture.check(Provider::Claude, &["structure-review", "tdd"]);
    fs::set_permissions(&locked, fs::Permissions::from_mode(0o755)).unwrap();
    match &report.skills[0].status {
        SkillAvailabilityStatus::Unchecked { reason } => {
            assert!(
                reason.contains(locked.join("SKILL.md").to_str().unwrap()),
                "{reason}"
            );
        }
        other => panic!("unreadable skill metadata must be unchecked, got {other:?}"),
    }
    assert_eq!(report.skills[0].installed_name, None);
    assert_eq!(report.skills[1].status, SkillAvailabilityStatus::Available);
    assert_eq!(report.skills[1].location.as_ref(), Some(&readable));
}

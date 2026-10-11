use ticketry_launch::stage_skill_warning;
use ticketry_provider::{Provider, SkillSearchEnvironment};

#[test]
fn missing_stage_skills_warn_and_a_later_check_finds_skills_in_the_actual_worktree() {
    let home = tempfile::tempdir().unwrap();
    let module = tempfile::tempdir().unwrap();
    let worktree = tempfile::tempdir().unwrap();
    let environment = SkillSearchEnvironment {
        home: Some(home.path().to_owned()),
        ..Default::default()
    };
    let names = vec!["tdd".to_owned(), "code-review".to_owned()];
    let module_skill = module.path().join(".agents/skills/tdd");
    std::fs::create_dir_all(&module_skill).unwrap();
    std::fs::write(module_skill.join("SKILL.md"), "module skill").unwrap();
    let warning =
        stage_skill_warning(Provider::Codex, Some(worktree.path()), &names, &environment).unwrap();
    let warning: serde_json::Value = serde_json::from_str(&warning).unwrap();
    assert_eq!(warning["provider"], "codex");
    assert_eq!(warning["skills"][0]["requested"], "tdd");
    assert_eq!(warning["skills"][0]["status"], "missing");
    assert_eq!(warning["skills"][1]["requested"], "code-review");
    assert_eq!(warning["skills"][1]["status"], "missing");
    assert!(!worktree.path().join(".agents").exists());
    for name in &names {
        let path = worktree.path().join(".agents/skills").join(name);
        std::fs::create_dir_all(&path).unwrap();
        std::fs::write(path.join("SKILL.md"), "installed").unwrap();
    }
    assert_eq!(
        stage_skill_warning(Provider::Codex, Some(worktree.path()), &names, &environment),
        None
    );
}

#[test]
fn unknown_directory_is_unchecked_and_read_failures_never_claim_installation() {
    let home = tempfile::tempdir().unwrap();
    let environment = SkillSearchEnvironment {
        home: Some(home.path().to_owned()),
        ..Default::default()
    };
    let names = vec!["tdd".to_owned()];
    let unknown: serde_json::Value = serde_json::from_str(
        &stage_skill_warning(Provider::Codex, None, &names, &environment).unwrap(),
    )
    .unwrap();
    assert_eq!(unknown["status"], "unchecked");
    assert_eq!(unknown["skills"][0]["status"], "unchecked");
    let worktree = tempfile::tempdir().unwrap();
    std::fs::write(
        worktree.path().join(".agents"),
        "a file blocks the skill root",
    )
    .unwrap();
    let unreadable: serde_json::Value = serde_json::from_str(
        &stage_skill_warning(Provider::Codex, Some(worktree.path()), &names, &environment).unwrap(),
    )
    .unwrap();
    assert_eq!(unreadable["skills"][0]["status"], "unchecked");
    assert!(unreadable["skills"][0]["reason"].as_str().is_some());
    assert_eq!(
        std::fs::read_to_string(worktree.path().join(".agents")).unwrap(),
        "a file blocks the skill root"
    );
}

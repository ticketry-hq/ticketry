use super::*;

#[test]
fn merged_chain_rejects_catalog_and_non_catalog_step_collisions() {
    let catalog = provider_catalog_migrations().unwrap();
    let collision = NonCatalogStep {
        step: catalog[0].step(),
        label: "collision",
        migration_id: None,
        runner: NonCatalogMigration::SprintExecution,
    };
    let error = merge_chain(&[collision], catalog).err().unwrap();
    assert!(error
        .to_string()
        .contains("duplicate final-schema chain step 44"));
}

#[test]
fn ordered_migration_ids_preserve_the_historical_public_list() {
    assert!(
        ORDERED_MIGRATION_IDS.starts_with(&[
            "0044_codex_5_6_model_catalog",
            "20260827-1520-project-onboarding-and-workspace-removal-v1",
            "0047_launch_binding_entry_skill",
            "20260827-1150-reviewed-workflow-state-colors-v1",
            "20260829-0049-workspace-tab-order-v1",
            "20260829-0050-module-presentation-v1",
            "0051_codex_5_3_model_catalog",
            "20260831-0052-worktree-pull-request-url-v1",
            "20260901-0053-workflow-transition-handoff-v1",
            "0054_codex_5_6_astra_model_catalog",
            "0055_codex_6_astra_model_rename",
            "0056_launch_binding_profile",
            "0057_codex_glm_5_3_flash_model_catalog",
            "20260915-0054-ship-record-v1",
            "0059_launch_binding_stage_skills",
            "0060_work_item_tags",
            "0061_codex_6_sol_luna_model_catalog",
            "0062_codex_6_1_sol_model_catalog",
            "0063_sprints",
        ]),
        "the frozen historical migration prefix must remain unchanged"
    );
}

#[test]
fn chain_steps_increase_across_both_sources() {
    let steps = chain().unwrap();
    assert!(
        steps
            .iter()
            .map(|step| step.step)
            .collect::<Vec<_>>()
            .starts_with(&[
                44, 45, 47, 48, 49, 50, 51, 52, 53, 54, 55, 56, 57, 58, 59, 60, 61, 62, 63, 64,
            ]),
        "the frozen historical step prefix must remain unchanged"
    );
    assert!(steps.windows(2).all(|pair| pair[0].step < pair[1].step));
    assert_eq!(steps[1].label, "0045-0046");
    assert_eq!(
        steps.iter().find(|step| step.step == 64).unwrap().label,
        "0064-exec"
    );
    assert_eq!(
        ORDERED_MIGRATION_IDS.last().copied(),
        steps.iter().rev().find_map(|step| step.migration_id)
    );
}

#[tokio::test]
async fn catalog_failures_keep_every_historical_startup_label() {
    let database = sea_orm::Database::connect("sqlite::memory:").await.unwrap();
    database.clone().close().await.unwrap();
    let catalog_steps: Vec<_> = chain()
        .unwrap()
        .into_iter()
        .filter(|step| matches!(step.runner, Migration::Catalog(_)))
        .collect();
    let labels = ["0044", "0051", "0054", "0055", "0057", "0061", "0062"];
    assert!(catalog_steps.len() >= labels.len());
    for (step, label) in catalog_steps.iter().zip(labels) {
        let error = step.install(&database).await.unwrap_err();
        assert!(
            error
                .to_string()
                .contains(&format!("final-schema migration {label} failed:")),
            "{error}"
        );
    }
}

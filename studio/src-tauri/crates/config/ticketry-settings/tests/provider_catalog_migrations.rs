use ticketry_settings::provider_catalog_migrations;

#[test]
fn public_registry_describes_each_migration_in_chain_order() {
    let migrations = provider_catalog_migrations().expect("validate catalog registry");
    let steps: Vec<_> = migrations
        .iter()
        .map(|migration| migration.step())
        .collect();
    assert!(steps.contains(&61));
    assert!(steps.contains(&62));
    assert!(std::ptr::eq(
        migrations,
        provider_catalog_migrations().unwrap()
    ));
    let latest: Vec<_> = migrations
        .iter()
        .map(|migration| {
            (
                migration.step(),
                migration.migration_id(),
                migration.ledger_table(),
            )
        })
        .collect();
    assert_eq!(
        latest,
        vec![
            (
                44,
                "0044_codex_5_6_model_catalog",
                "ticketry_codex_5_6_catalog_migration"
            ),
            (
                51,
                "0051_codex_5_3_model_catalog",
                "ticketry_codex_spark_catalog_migration"
            ),
            (
                54,
                "0054_codex_5_6_astra_model_catalog",
                "ticketry_codex_astra_catalog_migration"
            ),
            (
                55,
                "0055_codex_6_astra_model_rename",
                "ticketry_codex_6_astra_catalog_migration"
            ),
            (
                57,
                "0057_codex_glm_5_3_flash_model_catalog",
                "ticketry_codex_glm_5_3_flash_catalog_migration"
            ),
            (
                61,
                "0061_codex_6_sol_luna_model_catalog",
                "ticketry_codex_6_sol_luna_catalog_migration"
            ),
            (
                62,
                "0062_codex_6_1_sol_model_catalog",
                "ticketry_codex_6_1_sol_catalog_migration"
            ),
        ]
    );
    assert!(steps.windows(2).all(|pair| pair[0] < pair[1]));
    for migration in migrations {
        assert!(migration
            .migration_id()
            .starts_with(&format!("{:04}_", migration.step())));
        assert!(migration.ledger_table().starts_with("ticketry_"));
        assert!(migration.ledger_table().ends_with("_catalog_migration"));
    }
}

mod support;

use sea_orm::ConnectionTrait;
use ticketry_settings::install_provider_catalog_migration;

#[tokio::test]
async fn tampered_ledger_names_the_expected_migration_and_observed_version() {
    for migration in provider_catalog_migrations().unwrap() {
        for (assignment, stored_id, version) in [
            (
                "source_commit = 'ffffffffffffffffffffffffffffffffffffffff'",
                migration.migration_id(),
                1,
            ),
            (
                "migration_id = 'tampered_catalog_migration'",
                "tampered_catalog_migration",
                1,
            ),
            ("version = 2", migration.migration_id(), 2),
        ] {
            let (_directory, database) = support::open(migration.step()).await;
            install_provider_catalog_migration(&database, migration)
                .await
                .unwrap();
            // The shipped ledger correctly prohibits unknown versions. Disable
            // CHECK only on this disposable database to simulate corruption.
            database
                .execute_unprepared("PRAGMA ignore_check_constraints = ON")
                .await
                .unwrap();
            database
                .execute_unprepared(&format!(
                    "UPDATE {} SET {assignment}",
                    migration.ledger_table()
                ))
                .await
                .unwrap();
            let before = support::catalog_snapshot(&database).await;

            let error = install_provider_catalog_migration(&database, migration)
                .await
                .unwrap_err()
                .to_string();

            assert!(
                error.contains(migration.migration_id()),
                "missing expected migration identity: {error}"
            );
            assert!(
                error.contains(stored_id),
                "missing stored identity: {error}"
            );
            assert!(
                error.contains(&format!("version {version}")),
                "missing observed version: {error}"
            );
            assert_eq!(support::catalog_snapshot(&database).await, before);
        }
    }
}

#[tokio::test]
async fn each_registered_step_rolls_back_a_trigger_fault_and_can_be_retried() {
    for migration in provider_catalog_migrations().unwrap() {
        let (_directory, database) = support::open(migration.step()).await;
        let before = support::catalog_snapshot(&database).await;
        // Fail after at least the model write for reasoning migrations; the
        // rename step instead fails its UPDATE against a seeded legacy model.
        let (event, table) = match migration.step() {
            55 => ("UPDATE", "worktracker_agentmodel"),
            51 | 57 => ("INSERT", "worktracker_agentmodel"),
            _ => ("INSERT", "worktracker_agentmodelreasoninglevel"),
        };
        database.execute_unprepared(&format!(
            "CREATE TRIGGER catalog_fault BEFORE {event} ON {table} BEGIN SELECT RAISE(ABORT, 'injected catalog fault'); END"
        )).await.unwrap();

        let error = install_provider_catalog_migration(&database, migration)
            .await
            .unwrap_err();

        assert!(
            error.to_string().contains("injected catalog fault"),
            "{}: {error}",
            migration.migration_id()
        );
        assert!(
            !support::table_exists(&database, migration.ledger_table()).await,
            "{} left a ledger",
            migration.migration_id()
        );
        assert_eq!(
            support::catalog_snapshot(&database).await,
            before,
            "{} left catalog changes",
            migration.migration_id()
        );
        database
            .execute_unprepared("DROP TRIGGER catalog_fault")
            .await
            .unwrap();

        install_provider_catalog_migration(&database, migration)
            .await
            .unwrap();

        assert!(support::table_exists(&database, migration.ledger_table()).await);
        assert_eq!(
            support::catalog_contents(&database).await,
            support::expected_contents(migration.step()),
            "{} retry",
            migration.migration_id()
        );
        if migration.step() == 55 {
            assert!(
                support::catalog_snapshot(&database).await[0][0].starts_with("legacy-astra-id:")
            );
        }
    }
}

#[tokio::test]
async fn rerunning_each_registered_step_preserves_catalog_and_ledger_rows() {
    for migration in provider_catalog_migrations().unwrap() {
        let (_directory, database) = support::open(migration.step()).await;
        install_provider_catalog_migration(&database, migration)
            .await
            .unwrap();
        let first = support::catalog_snapshot(&database).await;
        database
            .execute_unprepared(&format!(
                "UPDATE {} SET applied_at = '2001-01-01 00:00:00'",
                migration.ledger_table()
            ))
            .await
            .unwrap();

        install_provider_catalog_migration(&database, migration)
            .await
            .unwrap();

        assert_eq!(
            support::catalog_snapshot(&database).await,
            first,
            "{} rerun",
            migration.migration_id()
        );
        assert_eq!(
            support::catalog_contents(&database).await,
            support::expected_contents(migration.step())
        );
        let ledger = database
            .query_one_raw(sea_orm::Statement::from_string(
                sea_orm::DbBackend::Sqlite,
                format!(
                    "SELECT COUNT(*) AS count, applied_at FROM {}",
                    migration.ledger_table()
                ),
            ))
            .await
            .unwrap()
            .unwrap();
        assert_eq!(ledger.try_get::<i64>("", "count").unwrap(), 1);
        assert_eq!(
            ledger.try_get::<String>("", "applied_at").unwrap(),
            "2001-01-01 00:00:00"
        );
    }
}

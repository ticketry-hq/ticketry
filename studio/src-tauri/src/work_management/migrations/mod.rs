use sea_orm_migration::prelude::*;

mod m20260827_000001_create_run_configurations;

pub struct Migrator;

#[async_trait::async_trait]
impl MigratorTrait for Migrator {
    fn migrations() -> Vec<Box<dyn MigrationTrait>> {
        vec![Box::new(
            m20260827_000001_create_run_configurations::Migration,
        )]
    }
}

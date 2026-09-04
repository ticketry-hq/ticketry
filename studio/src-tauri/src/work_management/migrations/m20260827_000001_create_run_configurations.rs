use sea_orm_migration::prelude::*;

pub struct Migration;

impl MigrationName for Migration {
    fn name(&self) -> &str {
        "m20260827_000001_create_run_configurations"
    }
}

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .create_table(
                Table::create()
                    .table(RunConfiguration::Table)
                    .if_not_exists()
                    .col(
                        ColumnDef::new(RunConfiguration::ModuleId)
                            .string_len(32)
                            .not_null()
                            .primary_key(),
                    )
                    .col(ColumnDef::new(RunConfiguration::Command).text().not_null())
                    .col(
                        ColumnDef::new(RunConfiguration::Environment)
                            .json()
                            .not_null(),
                    )
                    .col(ColumnDef::new(RunConfiguration::PreviewUrl).string())
                    .col(
                        ColumnDef::new(RunConfiguration::CreatedAt)
                            .date_time()
                            .not_null(),
                    )
                    .col(
                        ColumnDef::new(RunConfiguration::UpdatedAt)
                            .date_time()
                            .not_null(),
                    )
                    .foreign_key(
                        ForeignKey::create()
                            .name("fk_run_configuration_module")
                            .from(RunConfiguration::Table, RunConfiguration::ModuleId)
                            .to(WorkItem::Table, WorkItem::Id)
                            .on_delete(ForeignKeyAction::Cascade),
                    )
                    .to_owned(),
            )
            .await
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .drop_table(Table::drop().table(RunConfiguration::Table).to_owned())
            .await
    }
}

#[derive(DeriveIden)]
enum RunConfiguration {
    #[sea_orm(iden = "worktracker_runconfiguration")]
    Table,
    ModuleId,
    Command,
    Environment,
    PreviewUrl,
    CreatedAt,
    UpdatedAt,
}

#[derive(DeriveIden)]
enum WorkItem {
    #[sea_orm(iden = "worktracker_issue")]
    Table,
    Id,
}

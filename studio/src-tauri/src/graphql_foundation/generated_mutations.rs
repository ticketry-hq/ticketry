use sea_orm::{ActiveModelTrait, EntityTrait, IntoActiveModel};
use seaography::{
    Builder, EntityCreateBatchMutationBuilder, EntityCreateOneMutationBuilder,
    EntityDeleteMutationBuilder, EntityInputBuilder, EntityObjectBuilder,
    EntityUpdateMutationBuilder,
};

/// The generated Seaography writes to publish for one registered entity.
#[derive(Clone, Copy, Debug, Default, Eq, PartialEq)]
pub(crate) struct GeneratedMutations {
    pub create_one: bool,
    pub create_batch: bool,
    pub update: bool,
    pub delete: bool,
}

impl GeneratedMutations {
    pub const CREATE_ONE: Self = Self {
        create_one: true,
        create_batch: false,
        update: false,
        delete: false,
    };

    #[cfg(test)]
    const ALL: Self = Self {
        create_one: true,
        create_batch: true,
        update: true,
        delete: true,
    };

    fn any(self) -> bool {
        self.create_one || self.create_batch || self.update || self.delete
    }
}

/// Register selected fields from Seaography's generated mutation bundle.
///
/// The entity itself must already be registered with `mutation: false`. This
/// function only assembles Seaography's public builders; its generated
/// resolvers, guards, filters, codecs, and lifecycle hooks remain unchanged.
pub(crate) fn register_generated_mutations<T, A>(
    builder: &mut Builder,
    mutations: GeneratedMutations,
) where
    T: EntityTrait,
    T::Model: Sync + IntoActiveModel<A>,
    A: ActiveModelTrait<Entity = T> + sea_orm::ActiveModelBehavior + Send + 'static,
{
    if !mutations.any() {
        return;
    }

    let context = builder.context;
    builder
        .outputs
        .push(EntityObjectBuilder { context }.to_basic_object::<T>());

    let input_builder = EntityInputBuilder { context };
    if mutations.create_one || mutations.create_batch {
        builder
            .inputs
            .push(input_builder.insert_input_object::<T>());
    }
    if mutations.update {
        builder
            .inputs
            .push(input_builder.update_input_object::<T>());
    }

    if mutations.create_one {
        builder
            .mutations
            .push(EntityCreateOneMutationBuilder { context }.to_field::<T, A>());
    }
    if mutations.create_batch {
        builder
            .mutations
            .push(EntityCreateBatchMutationBuilder { context }.to_field::<T, A>());
    }
    if mutations.update {
        builder
            .mutations
            .push(EntityUpdateMutationBuilder { context }.to_field::<T, A>());
    }
    if mutations.delete {
        builder
            .mutations
            .push(EntityDeleteMutationBuilder { context }.to_field::<T, A>());
    }
}

#[cfg(test)]
mod tests {
    use std::sync::LazyLock;

    use sea_orm::Database;
    use seaography::BuilderContext;

    use super::*;
    use crate::entities::foundation::migration_probes;

    static CONTEXT: LazyLock<BuilderContext> = LazyLock::new(BuilderContext::default);
    static INSERT_POLICY_CONTEXT: LazyLock<BuilderContext> = LazyLock::new(|| {
        let mut context = BuilderContext::default();
        context
            .entity_input
            .insert_skips
            .push("MigrationProbes.value".to_owned());
        context
    });

    async fn selective_sdl(
        context: &'static BuilderContext,
        mutations: GeneratedMutations,
    ) -> String {
        let database = Database::connect("sqlite::memory:")
            .await
            .expect("open selective mutation test database");
        let mut builder = Builder::new(context, database.clone());
        seaography::register_entity!(builder, migration_probes, mutation: false);
        register_generated_mutations::<migration_probes::Entity, migration_probes::ActiveModel>(
            &mut builder,
            mutations,
        );
        builder
            .schema_builder()
            .data(database)
            .finish()
            .expect("build selective mutation test schema")
            .sdl()
    }

    async fn native_bundle_sdl() -> String {
        let database = Database::connect("sqlite::memory:")
            .await
            .expect("open native mutation test database");
        let mut builder = Builder::new(&CONTEXT, database.clone());
        seaography::register_entity!(builder, migration_probes);
        builder
            .schema_builder()
            .data(database)
            .finish()
            .expect("build native mutation test schema")
            .sdl()
    }

    #[tokio::test]
    async fn all_selection_matches_seaography_native_bundle() {
        assert_eq!(
            selective_sdl(&CONTEXT, GeneratedMutations::ALL).await,
            native_bundle_sdl().await
        );
    }

    #[tokio::test]
    async fn each_flag_exposes_only_its_mutation_and_required_inputs() {
        let cases = [
            (GeneratedMutations::CREATE_ONE, "CreateOne", true, false),
            (
                GeneratedMutations {
                    create_batch: true,
                    ..GeneratedMutations::default()
                },
                "CreateBatch",
                true,
                false,
            ),
            (
                GeneratedMutations {
                    update: true,
                    ..GeneratedMutations::default()
                },
                "Update",
                false,
                true,
            ),
            (
                GeneratedMutations {
                    delete: true,
                    ..GeneratedMutations::default()
                },
                "Delete",
                false,
                false,
            ),
        ];

        for (selection, selected, has_insert, has_update) in cases {
            let sdl = selective_sdl(&CONTEXT, selection).await;
            for operation in ["CreateOne", "CreateBatch", "Update", "Delete"] {
                assert_eq!(
                    sdl.contains(&format!("migrationProbes{operation}(")),
                    operation == selected,
                    "unexpected {operation} field for {selection:?}"
                );
            }
            assert_eq!(sdl.contains("input MigrationProbesInsertInput"), has_insert);
            assert_eq!(sdl.contains("input MigrationProbesUpdateInput"), has_update);
            assert!(sdl.contains("type MigrationProbesBasic"));
        }
    }

    #[tokio::test]
    async fn empty_selection_registers_no_mutation_support_types() {
        let sdl = selective_sdl(&CONTEXT, GeneratedMutations::default()).await;

        assert!(!sdl.contains("type MigrationProbesBasic"));
        assert!(!sdl.contains("input MigrationProbesInsertInput"));
        assert!(!sdl.contains("input MigrationProbesUpdateInput"));
    }

    #[tokio::test]
    async fn selected_mutation_preserves_context_input_policy() {
        let sdl = selective_sdl(&INSERT_POLICY_CONTEXT, GeneratedMutations::CREATE_ONE).await;
        let start = sdl
            .find("input MigrationProbesInsertInput {")
            .expect("insert input exists");
        let input = &sdl[start..];
        let input = &input[..input.find("\n}").expect("insert input terminates")];

        assert!(input.contains("\n\tid:"));
        assert!(!input.contains("\n\tvalue:"));
    }
}

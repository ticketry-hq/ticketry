//! Compiler authority for the scanner's explicitly supported workspace macros.
//! These probes use the shipping dependency graph and observe expansion contracts.
#[path = "public_api/desktop_macro_exports.rs"]
mod desktop_macro_exports;

use sea_orm::sea_query::Iden;
use seaography::{CustomFields, CustomInputType, CustomOutputType};
use ticketry_entities::migration_probes;

#[derive(sea_orm::FromQueryResult)]
struct QueryRow {
    value: String,
}

#[derive(sea_orm::DeriveMigrationName)]
struct Migration;

#[derive(sea_orm::DeriveIden)]
enum TableName {
    Table,
    Value,
}

#[derive(Clone, schemars::JsonSchema)]
struct JsonInput {
    value: String,
}

#[derive(CustomInputType)]
#[seaography(input_type_name = "ContractInput")]
struct ContractInput {
    value: String,
}

#[derive(Clone, CustomOutputType)]
struct ContractOutput {
    value: String,
}

struct ContractFields;

#[CustomFields]
impl ContractFields {
    async fn contract_value(input: ContractInput) -> seaography::async_graphql::Result<String> {
        Ok(input.value)
    }
}

struct Query;

#[async_graphql::Object]
impl Query {
    async fn contract_value(&self) -> &str {
        "preserved"
    }
}

#[async_trait::async_trait]
trait Capability {
    async fn value(&self) -> &str;
}

struct Implementation;

// The real code uses both the direct dependency and this SeaORM re-export.
#[sea_orm::prelude::async_trait::async_trait]
impl Capability for Implementation {
    async fn value(&self) -> &str {
        "preserved"
    }
}

tokio::task_local! {
    static TASK_VALUE: &'static str;
}

thread_local! {
    static THREAD_VALUE: std::cell::Cell<u32> = const { std::cell::Cell::new(0) };
}

mod entity_registration {
    pub use ticketry_entities::migration_probes;
    seaography::register_entity_modules!([migration_probes,]);
}

mod commands {
    #[tauri::command]
    pub(crate) fn contract_ping() -> &'static str {
        "preserved"
    }
}

mod mobile_entry {
    // Compile the cfg-union's inactive desktop branch without starting an app.
    #[tauri_macros::mobile_entry_point]
    fn run() {}
}

fn supported_derive_and_registration_contracts_compile() {
    fn query_row<R: sea_orm::FromQueryResult>() {}
    query_row::<QueryRow>();
    assert_eq!(
        sea_orm_migration::MigrationName::name(&Migration),
        "public_api_workspace_macro_compile"
    );
    assert_eq!(TableName::Table.to_string(), "table_name");
    assert_eq!(TableName::Value.to_string(), "value");
    let schema = schemars::schema_for!(JsonInput).to_value();
    assert_eq!(schema["properties"]["value"]["type"], "string");
    let _ = JsonInput {
        value: "value".into(),
    }
    .value;
    let _ = QueryRow {
        value: "value".into(),
    }
    .value;
    let context = Box::leak(Box::new(seaography::BuilderContext::default()));
    assert_eq!(
        ContractInput::gql_input_type_ref(context).to_string(),
        "ContractInput!"
    );
    assert_eq!(
        ContractOutput::gql_output_type_ref(context).to_string(),
        "ContractOutput!"
    );
    let fields = ContractFields::to_fields(context);
    assert_eq!(fields.len(), 1);
    let _: fn(seaography::Builder) -> seaography::Builder =
        entity_registration::register_entity_modules;
    let _: fn(seaography::Builder) -> seaography::Builder = |mut builder| {
        seaography::register_entity!(builder, migration_probes);
        builder
    };
    let _ = ContractOutput {
        value: "value".into(),
    }
    .value;
}

async fn supported_async_and_graphql_macros_preserve_the_public_contract() {
    let capability: &dyn Capability = &Implementation;
    let result = TASK_VALUE
        .scope("scoped", async {
            let pending = capability.value();
            tokio::pin!(pending);
            tokio::select! {
                value = &mut pending => (TASK_VALUE.with(|value| *value), value),
            }
        })
        .await;
    assert_eq!(result, ("scoped", "preserved"));
    assert!(TASK_VALUE.try_with(|value| *value).is_err());
    THREAD_VALUE.with(|value| value.set(7));
    assert_eq!(THREAD_VALUE.with(|value| value.get()), 7);
    let schema = async_graphql::Schema::build(
        Query,
        async_graphql::EmptyMutation,
        async_graphql::EmptySubscription,
    )
    .finish();
    let response = schema.execute("{ contractValue }").await;
    assert!(response.errors.is_empty(), "{:?}", response.errors);
    assert_eq!(
        response.data.into_json().unwrap(),
        serde_json::json!({"contractValue": "preserved"})
    );
}

fn supported_desktop_handler_and_transport_expansions_compile() {
    fn handler<H: Fn(tauri::ipc::Invoke<tauri::Wry>) -> bool + Send + Sync + 'static>(_: H) {}
    handler(tauri::generate_handler![commands::contract_ping]);
    assert_eq!(commands::contract_ping(), "preserved");
    let _: extern "C" fn() = mobile_entry::start_app;
    // Actual facade types prove the pinned TauRPC procedures/resolvers expansion.
    let api = tauri_graphql::TransportApiImpl::new();
    let _ = tauri_graphql::TransportApi::into_handler(api);
}

#[tokio::test]
async fn reviewed_workspace_macro_expansions_preserve_namespace_contracts() {
    supported_derive_and_registration_contracts_compile();
    supported_async_and_graphql_macros_preserve_the_public_contract().await;
    supported_desktop_handler_and_transport_expansions_compile();
}

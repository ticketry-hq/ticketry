use tauri::ipc::Invoke;
use tauri::Runtime;
use tauri_graphql::{TransportApi, TransportApiImpl};

pub fn transport_api() -> TransportApiImpl {
    TransportApiImpl::new()
}

pub fn combine_with_native_handler<R, N>(
    native_handler: N,
    api: TransportApiImpl,
) -> impl Fn(Invoke<R>) -> bool + Send + Sync + 'static
where
    R: Runtime,
    N: Fn(Invoke<R>) -> bool + Send + Sync + 'static,
{
    let graphql_handler = taurpc::create_ipc_handler(api.into_handler());
    move |invoke| {
        if invoke.message.command().starts_with("TauRPC__") {
            graphql_handler(invoke)
        } else {
            native_handler(invoke)
        }
    }
}

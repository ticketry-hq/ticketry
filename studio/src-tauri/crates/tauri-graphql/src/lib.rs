mod api;
mod endpoint;

pub use api::{valid_subscription_id, GraphQlSubscriptionStream, TransportApi, TransportApiImpl};
pub use endpoint::GraphQlEndpoint;

pub fn export_bindings(path: impl AsRef<std::path::Path>) -> Result<(), String> {
    let path = path.as_ref();
    let api = TransportApiImpl::new();
    taurpc::Exporter::new()
        .export(&api.into_handler(), path)
        .map_err(|error| format!("cannot export TauRPC bindings: {error}"))?;
    let generated = std::fs::read_to_string(path)
        .map_err(|error| format!("cannot read TauRPC bindings: {error}"))?;
    let generated = self_contained_typescript_proxy(&generated)?;
    std::fs::write(path, format!("{}\n", generated.trim_end()))
        .map_err(|error| format!("cannot normalize TauRPC bindings: {error}"))
}

fn self_contained_typescript_proxy(generated: &str) -> Result<String, String> {
    let import_start = generated
        .find("import { createTauRPCProxy")
        .ok_or_else(|| "generated TauRPC bindings have an unknown import shape".to_owned())?;
    let router_start = generated
        .find("export type Router =")
        .ok_or_else(|| "generated TauRPC bindings have no router type".to_owned())?;
    let proxy_start = generated
        .find("export const createTauRPCProxy = () =>")
        .ok_or_else(|| "generated TauRPC bindings have no proxy factory".to_owned())?;
    let proxy_end = generated[proxy_start..]
        .find("\n\n// export const")
        .map(|offset| proxy_start + offset)
        .ok_or_else(|| "generated TauRPC bindings have an unknown proxy shape".to_owned())?;
    let _trailing_comment_end = generated[proxy_end..]
        .find("\nexport type")
        .map(|offset| proxy_end + offset)
        .ok_or_else(|| "generated TauRPC bindings have no exported type trailer".to_owned())?;

    let mut output = String::new();
    output.push_str(&generated[..import_start]);
    output.push_str("import { Channel, invoke } from '@tauri-apps/api/core'\n");
    output.push_str(&generated[router_start..proxy_start]);
    output.push_str(
        r#"export type GraphQlTransportProxy = Router[""];
export const createTauRPCProxy = (): GraphQlTransportProxy => ({
  graphql_execute: (requestJson) =>
    invoke<string>("TauRPC__graphql_execute", { request_json: requestJson }),
  graphql_subscribe: (subscriptionId, requestJson, onEvent) => {
    const channel = new Channel<string>();
    channel.onmessage = onEvent;
    return invoke<string>("TauRPC__graphql_subscribe", {
      subscription_id: subscriptionId,
      request_json: requestJson,
      on_event: channel,
    });
  },
  graphql_unsubscribe: (subscriptionId) =>
    invoke<boolean>("TauRPC__graphql_unsubscribe", {
      subscription_id: subscriptionId,
    }),
});
"#,
    );
    Ok(output)
}

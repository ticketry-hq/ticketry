fn main() {
    let output = std::env::args()
        .nth(1)
        .expect("usage: export_foundation_bindings <taurpc.ts>");
    muxed_studio_lib::graphql_foundation::export_transport_bindings(&output)
        .expect("export GraphQL TauRPC bindings");
    println!("{output}");
}

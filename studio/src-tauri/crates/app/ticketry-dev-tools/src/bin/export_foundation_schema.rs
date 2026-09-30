#[tokio::main]
async fn main() {
    let output = std::env::args()
        .nth(1)
        .expect("usage: export_foundation_schema <output.graphql>");
    let schema = ticketry_graphql_schema::generated_schema_sdl()
        .await
        .expect("build the GraphQL foundation schema");
    std::fs::write(&output, schema).expect("write the generated foundation SDL");
    println!("{output}");
}

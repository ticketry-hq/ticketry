use serde_json::Value;

use super::*;

const GOLDEN: &str = "src/tool_surface/published_tools.golden.json";

fn golden_path() -> std::path::PathBuf {
    std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join(GOLDEN)
}

/// Object keys sorted, so a snapshot diff is only ever a semantic change.
fn canonical(value: Value) -> Value {
    match value {
        Value::Object(object) => {
            let mut entries: Vec<_> = object.into_iter().collect();
            entries.sort_by(|left, right| left.0.cmp(&right.0));
            Value::Object(
                entries
                    .into_iter()
                    .map(|(key, value)| (key, canonical(value)))
                    .collect(),
            )
        }
        Value::Array(values) => Value::Array(values.into_iter().map(canonical).collect()),
        value => value,
    }
}

/// The single schema contract: names, order, descriptions and input schemas
/// as clients see them. Regenerate deliberately with
/// `TICKETRY_UPDATE_MCP_GOLDEN=1` and review the diff as public API.
#[test]
fn published_tools_match_the_golden_snapshot() {
    let path = golden_path();
    let published = canonical(serde_json::to_value(published_tools()).unwrap());
    let published = serde_json::to_string_pretty(&published).unwrap() + "\n";
    if std::env::var_os("TICKETRY_UPDATE_MCP_GOLDEN").is_some() {
        std::fs::write(&path, &published).unwrap();
    }
    let golden = std::fs::read_to_string(&path)
        .unwrap_or_else(|error| panic!("read {}: {error}", path.display()));
    assert_eq!(
        published, golden,
        "published MCP tools drifted from {GOLDEN}"
    );
}

#[test]
fn provider_operations_are_every_published_tool_plus_lifecycle() {
    let golden: Vec<Value> =
        serde_json::from_str(&std::fs::read_to_string(golden_path()).unwrap()).unwrap();
    let mut expected: Vec<String> = golden
        .iter()
        .map(|tool| tool["name"].as_str().unwrap().to_owned())
        .collect();
    expected.push("provider_lifecycle".to_owned());
    assert_eq!(expected.len(), 36);
    assert_eq!(allowed_provider_operations(), expected);
}

#[test]
fn a_name_published_twice_fails_composition() {
    let twice =
        || TypedTool::without_parameters("probe", "Probe.", |_call| async { unreachable!() });
    let mut first = TypedTools::default().with(twice());
    first.merge(TypedTools::default().with(twice()));
    let Err(error) = ToolSurface::compose(first) else {
        panic!("two capability routers publishing one name must be refused");
    };
    assert!(error.contains("probe"), "{error}");

    let mut shadowing = sprint_tools::typed_tools();
    shadowing.merge(TypedTools::default().with(TypedTool::without_parameters(
        "get_sprint_goals",
        "A second get_sprint_goals.",
        |_call| async { unreachable!() },
    )));
    let Err(error) = ToolSurface::compose(shadowing) else {
        panic!("a tool shadowing another capability's tool must be refused");
    };
    assert!(error.contains("get_sprint_goals"), "{error}");
}

#[test]
fn a_route_without_a_typed_definition_never_reaches_the_surface() {
    let mut typed = read_tools::typed_tools();
    typed
        .router
        .add_route(rmcp::handler::server::tool::ToolRoute::new_dyn(
            rmcp::model::Tool::new(
                "hand_rolled",
                "A tool registered beside the typed definitions.",
                rmcp::model::object(serde_json::json!({"type": "object"})),
            ),
            |_context| Box::pin(async { unreachable!() }),
        ));
    let Err(error) = ToolSurface::compose(typed) else {
        panic!("a route registered without TypedTool must be refused");
    };
    assert!(error.contains("hand_rolled"), "{error}");
    assert!(error.contains("typed definition"), "{error}");
}

/// Every non-test source module, as `(path relative to src, contents)`.
fn production_sources() -> Vec<(String, String)> {
    fn walk(directory: &std::path::Path, root: &std::path::Path, out: &mut Vec<(String, String)>) {
        for entry in std::fs::read_dir(directory).unwrap() {
            let path = entry.unwrap().path();
            let relative = path.strip_prefix(root).unwrap().display().to_string();
            if path.is_dir() {
                if path.file_name().is_some_and(|name| name != "tests") {
                    walk(&path, root, out);
                }
            } else if relative.ends_with(".rs")
                && !relative.ends_with("tests.rs")
                && relative != "test_support.rs"
            {
                out.push((relative, std::fs::read_to_string(&path).unwrap()));
            }
        }
    }
    let root = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("src");
    let mut sources = Vec::new();
    walk(&root, &root, &mut sources);
    sources
}

/// One registration mechanism: tool modules declare typed parameters, a
/// handler and a description. Handwritten schemas, raw routes, raw argument
/// objects and the legacy dispatch answer type stay out of the crate.
#[test]
fn tools_register_only_through_typed_definitions() {
    let sources = production_sources();
    assert!(
        sources.len() > 20,
        "walked too few sources: {}",
        sources.len()
    );
    for (path, source) in &sources {
        for forbidden in ["\"type\": \"object\"", "DispatchOutput", "mod dispatch"] {
            assert!(!source.contains(forbidden), "{path} contains {forbidden}");
        }
        let owner_only = [
            ("ToolRoute", "tool_surface/typed_tool.rs"),
            ("JsonObject", "tool_surface/argument_rejection.rs"),
        ];
        for (needle, owner) in owner_only {
            assert!(
                !source.contains(needle) || path == owner || path == "tool_surface/typed_tool.rs",
                "{path} reaches {needle}; only {owner} may"
            );
        }
    }
}

use quote::ToTokens;
use syn::ext::IdentExt;
use syn::punctuated::Punctuated;
use syn::{Attribute, Expr, Lit, Meta, Path, Token};

#[derive(Default)]
pub struct Evidence {
    pub gates: Vec<String>,
    pub paths: Vec<(String, Vec<String>)>,
    pub conditional_path: bool,
    pub macro_export: bool,
    pub macro_use: bool,
    pub generated: Vec<(String, String, Vec<String>)>,
    pub expansions: Vec<String>,
    pub macro_references: Vec<(Vec<String>, Vec<String>)>,
    pub helpers: Vec<String>,
    pub root_command_macros: bool,
    pub mobile_entry: bool,
    pub errors: Vec<String>,
}

pub fn inspect(attributes: &[Attribute]) -> Evidence {
    let mut evidence = Evidence::default();
    for attribute in attributes {
        collect(&attribute.meta, &[], &mut evidence);
    }
    evidence.gates.sort();
    evidence.gates.dedup();
    evidence
}

pub fn inspect_meta(meta: &Meta) -> Evidence {
    let mut evidence = Evidence::default();
    collect(meta, &[], &mut evidence);
    evidence
}

fn collect(meta: &Meta, conditions: &[String], evidence: &mut Evidence) {
    if meta.path().is_ident("cfg") {
        let text = meta.to_token_stream().to_string();
        evidence.gates.push(if conditions.is_empty() {
            text
        } else {
            format!("{} => {text}", conditions.join(" && "))
        });
    } else if meta.path().is_ident("macro_use") {
        evidence.macro_use = true;
    } else if meta.path().is_ident("macro_export") {
        evidence.macro_export = true;
        evidence.gates.extend(conditions.iter().cloned());
    } else if meta.path().is_ident("path") {
        match meta {
            Meta::NameValue(value) => match &value.value {
                Expr::Lit(literal) => match &literal.lit {
                    Lit::Str(path) => {
                        evidence.paths.push((path.value(), conditions.to_vec()));
                        evidence.conditional_path |= !conditions.is_empty();
                    }
                    _ => evidence
                        .errors
                        .push("module #[path] must be a string".into()),
                },
                _ => evidence
                    .errors
                    .push("module #[path] must be a string".into()),
            },
            _ => evidence
                .errors
                .push("unsupported module #[path] attribute".into()),
        }
    } else if meta.path().is_ident("cfg_attr") {
        let Meta::List(list) = meta else {
            evidence
                .errors
                .push("unsupported cfg_attr attribute".into());
            return;
        };
        let Ok(parts) = list.parse_args_with(Punctuated::<Meta, Token![,]>::parse_terminated)
        else {
            evidence
                .errors
                .push("cannot resolve cfg_attr attribute arguments".into());
            return;
        };
        let mut parts = parts.iter();
        let Some(condition) = parts.next() else {
            evidence
                .errors
                .push("cfg_attr requires a condition and attribute".into());
            return;
        };
        let mut nested = conditions.to_vec();
        nested.push(format!("cfg({})", condition.to_token_stream()));
        let mut count = 0;
        for attribute in parts {
            count += 1;
            if !supported_conditional(attribute) {
                evidence.errors.push(format!(
                    "unsupported cfg_attr-controlled attribute `{}`; add explicit source handling and compile evidence",
                    attribute.to_token_stream()
                ));
            }
            collect(attribute, &nested, evidence);
        }
        if count == 0 {
            evidence
                .errors
                .push("cfg_attr requires an attribute".into());
        }
    } else if meta.path().is_ident("derive") {
        let Meta::List(list) = meta else {
            evidence
                .errors
                .push("unsupported derive expansion; needs compile evidence".into());
            return;
        };
        let Ok(paths) = list.parse_args_with(Punctuated::<Path, Token![,]>::parse_terminated)
        else {
            evidence
                .errors
                .push("unsupported derive expansion arguments; needs compile evidence".into());
            return;
        };
        for path in paths {
            evidence.macro_references.push((
                path.segments
                    .iter()
                    .map(|part| part.ident.unraw().to_string())
                    .collect(),
                conditions.to_vec(),
            ));
            let name = path
                .segments
                .iter()
                .map(|segment| segment.ident.unraw().to_string())
                .collect::<Vec<_>>()
                .join("::");
            if name == "DeriveEntityModel" || name == "sea_orm::DeriveEntityModel" {
                evidence.expansions.push("SeaORM DeriveEntityModel".into());
                generated(
                    evidence,
                    conditions,
                    &[
                        ("Entity", "struct"),
                        ("Column", "enum"),
                        ("PrimaryKey", "enum"),
                        ("ActiveModel", "struct"),
                    ],
                );
            } else if ![
                "CustomOutputType",
                "CustomInputType",
                "JsonSchema",
                "FromQueryResult",
                "DeriveMigrationName",
                "DeriveIden",
                "Clone",
                "Copy",
                "Debug",
                "Default",
                "PartialEq",
                "Eq",
                "PartialOrd",
                "Ord",
                "Hash",
                "Serialize",
                "Deserialize",
                "serde::Serialize",
                "serde::Deserialize",
            ]
            .contains(&name.as_str())
                && !reviewed_macro_path(&path)
            {
                evidence.errors.push(format!("unsupported derive expansion `{name}`; add explicit handling and compile evidence"));
            }
        }
    } else if meta
        .path()
        .segments
        .iter()
        .map(|segment| segment.ident.unraw().to_string())
        .collect::<Vec<_>>()
        == ["sea_orm", "model"]
    {
        evidence
            .macro_references
            .push((vec!["sea_orm".into(), "model".into()], conditions.to_vec()));
        if !matches!(meta, Meta::Path(_)) {
            evidence.errors.push("unsupported SeaORM model expansion options; add exact generated inventory handling and compile evidence".into());
            return;
        }
        evidence.expansions.push("SeaORM model".into());
        generated(
            evidence,
            conditions,
            &[
                ("ModelEx", "struct"),
                ("ActiveModelEx", "struct"),
                ("Relation", "enum"),
                ("RelatedEntity", "enum"),
                ("TypedColumn", "struct"),
                ("COLUMN", "const"),
                ("EntityLoader", "struct"),
                ("EntityReverse", "struct"),
                ("EntityLoaderWith", "struct"),
                ("EntityLoaderNest", "struct"),
                ("EntityLoaderWithParam", "trait"),
            ],
        );
    } else if reviewed_attribute(meta) {
        let path = meta
            .path()
            .segments
            .iter()
            .map(|part| part.ident.unraw().to_string())
            .collect::<Vec<_>>();
        evidence.root_command_macros |= path == ["tauri", "command"];
        evidence.mobile_entry |= path == ["tauri", "mobile_entry_point"];
        evidence.macro_references.push((path, conditions.to_vec()));
    } else if meta.path().is_ident("serde")
        || meta.path().is_ident("sea_orm")
        || meta.path().is_ident("seaography")
    {
        let helper = meta.path().get_ident().unwrap().to_string();
        evidence.helpers.push(helper.clone());
        evidence
            .macro_references
            .push((vec![helper, "__helper".into()], conditions.to_vec()));
    } else if !supported_plain(meta) {
        evidence.errors.push(format!(
            "unsupported attribute expansion `{}`; add explicit handling and compile evidence",
            meta.path().to_token_stream()
        ));
    }
}

fn generated(evidence: &mut Evidence, conditions: &[String], items: &[(&str, &str)]) {
    evidence.generated.extend(items.iter().map(|(name, kind)| {
        (
            (*name).into(),
            format!("generated-{kind}"),
            conditions.to_vec(),
        )
    }));
}

fn supported_plain(meta: &Meta) -> bool {
    [
        "derive",
        "cfg",
        "cfg_attr",
        "path",
        "macro_export",
        "macro_use",
        "doc",
        "allow",
        "warn",
        "deny",
        "forbid",
        "inline",
        "cold",
        "deprecated",
        "must_use",
        "repr",
        "non_exhaustive",
        "track_caller",
        "no_mangle",
        "export_name",
        "link_section",
        "link",
        "link_name",
        "link_ordinal",
        "target_feature",
        "test",
        "bench",
        "ignore",
        "should_panic",
        "global_allocator",
        "panic_handler",
        "no_std",
        "no_main",
        "recursion_limit",
        "type_length_limit",
        "feature",
        "crate_type",
        "crate_name",
        "serde",
        "sea_orm",
    ]
    .iter()
    .any(|name| meta.path().is_ident(name))
        || meta.path().to_token_stream().to_string() == "rustfmt :: skip"
}

fn supported_conditional(meta: &Meta) -> bool {
    [
        "cfg",
        "cfg_attr",
        "path",
        "macro_export",
        "derive",
        "doc",
        "allow",
        "warn",
        "deny",
        "forbid",
        "inline",
        "cold",
        "deprecated",
        "must_use",
        "repr",
        "non_exhaustive",
        "track_caller",
        "no_mangle",
        "export_name",
        "link_section",
    ]
    .iter()
    .any(|name| meta.path().is_ident(name))
        || reviewed_attribute(meta)
}

fn reviewed_macro_path(path: &Path) -> bool {
    matches!(
        path.segments
            .last()
            .map(|part| part.ident.unraw().to_string())
            .as_deref(),
        Some(
            "CustomOutputType"
                | "CustomInputType"
                | "JsonSchema"
                | "FromQueryResult"
                | "DeriveMigrationName"
                | "DeriveIden"
        )
    )
}

fn reviewed_attribute(meta: &Meta) -> bool {
    let path = meta
        .path()
        .segments
        .iter()
        .map(|part| part.ident.unraw().to_string())
        .collect::<Vec<_>>();
    match path
        .iter()
        .map(String::as_str)
        .collect::<Vec<_>>()
        .as_slice()
    {
        ["async_trait"]
        | ["async_trait", "async_trait"]
        | ["sea_orm", "prelude", "async_trait", "async_trait"] => {
            matches!(meta, Meta::Path(_))
                || matches!(meta, Meta::List(list) if list.tokens.to_string() == "? Send")
        }
        ["CustomFields"]
        | ["seaography", "CustomFields"]
        | ["Object"]
        | ["async_graphql", "Object"]
        | ["taurpc", "procedures"]
        | ["taurpc", "resolvers"]
        | ["tauri", "mobile_entry_point"] => matches!(meta, Meta::Path(_)),
        ["tauri", "command"] => {
            matches!(meta, Meta::Path(_))
                || matches!(meta, Meta::List(list) if list.tokens.to_string() == "async")
        }
        ["tokio", "test"] => {
            matches!(meta, Meta::Path(_))
                || matches!(meta, Meta::List(list) if matches!(list.tokens.to_string().as_str(), "flavor = \"current_thread\"" | "flavor = \"multi_thread\" , worker_threads = 4"))
        }
        _ => false,
    }
}

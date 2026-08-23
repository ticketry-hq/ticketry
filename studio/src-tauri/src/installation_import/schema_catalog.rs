//! Generated SQLite staging schemas for every supported Django generation.

use std::sync::OnceLock;

use serde::Deserialize;

#[derive(Debug, Deserialize)]
struct Catalog {
    version: u32,
    generated_by: String,
    statements: Vec<String>,
    schemas: Vec<Schema>,
}

#[derive(Debug, Deserialize)]
struct Schema {
    generation: String,
    fingerprint: String,
    statement_ids: Vec<usize>,
}

pub struct Selected {
    pub fingerprint: &'static str,
    pub statements: Vec<&'static str>,
}

pub fn select(generation: &str) -> Result<Selected, String> {
    let catalog = catalog();
    let schema = catalog
        .schemas
        .iter()
        .find(|schema| schema.generation == generation)
        .ok_or_else(|| format!("no checked PostgreSQL staging schema exists for {generation}"))?;
    let statements = schema
        .statement_ids
        .iter()
        .map(|index| {
            catalog
                .statements
                .get(*index)
                .map(String::as_str)
                .ok_or_else(|| format!("{generation} names missing staging statement {index}"))
        })
        .collect::<Result<Vec<_>, _>>()?;
    Ok(Selected {
        fingerprint: &schema.fingerprint,
        statements,
    })
}

fn catalog() -> &'static Catalog {
    static CATALOG: OnceLock<Catalog> = OnceLock::new();
    CATALOG.get_or_init(|| {
        let catalog =
            serde_json::from_str::<Catalog>(include_str!("postgres-staging-schemas.v1.json"))
                .expect("the checked PostgreSQL staging catalog must deserialize");
        assert_eq!(catalog.version, 1);
        assert_eq!(catalog.generated_by, "scripts/installation_corpus.py");
        catalog
    })
}

#[cfg(test)]
mod tests {
    use super::{catalog, select};
    use crate::installation_classification::manifest;

    #[test]
    fn every_supported_django_generation_has_its_exact_staging_schema() {
        let expected = manifest()
            .generations
            .iter()
            .filter(|generation| generation.kind.starts_with("django-"))
            .count();
        assert_eq!(catalog().schemas.len(), expected);
        for generation in manifest()
            .generations
            .iter()
            .filter(|generation| generation.kind.starts_with("django-"))
        {
            let selected = select(&generation.name).unwrap();
            assert_eq!(selected.fingerprint, generation.fingerprint);
            assert!(!selected.statements.is_empty());
        }
    }
}

//! The checked manifest of every installation shape Ticketry supports.
//!
//! The manifest is generated from Django's own migrations by
//! `scripts/installation_corpus.py`, never edited by hand. It records the
//! product migration graph, every supported generation with the schema
//! fingerprint that generation produces, the full semantic facts of the current
//! generation, and the corpus of fixtures that must classify exactly.

use std::collections::{BTreeMap, BTreeSet};
use std::sync::OnceLock;

use serde::Deserialize;

use super::schema_facts::{ProductSchema, TableFacts};

/// One product migration and the migrations it requires.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq)]
pub struct MigrationStep {
    /// The migration file name, without its app.
    pub name: String,
    /// `[app, name]` pairs this step requires, product or framework.
    pub dependencies: Vec<[String; 2]>,
}

/// One supported installation shape.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq)]
pub struct Generation {
    /// The manifest's stable name for this generation.
    pub name: String,
    /// The engine that produced the recorded fingerprint.
    pub engine: String,
    /// How the generation is rebuilt: a Django boundary, Alembic, or current.
    pub kind: String,
    /// What adoption must do with it: `adopt`, `bridge`, or `provision`.
    pub expected: String,
    /// Product migrations applied, as `app.name`, sorted.
    pub applied: Vec<String>,
    /// Product tables the generation carries.
    pub product_table_count: usize,
    /// The checked schema fingerprint.
    pub fingerprint: String,
    /// Prior-attempt corpus fixtures this generation reproduces.
    pub ports: Vec<String>,
    /// Why the generation exists, for support and review.
    pub note: String,
}

/// One materialized fixture: a generation plus the content stored in it.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq)]
pub struct CorpusFixture {
    /// The fixture name the corpus builder materializes.
    pub name: String,
    /// The generation the fixture reproduces.
    pub generation: String,
    /// What is stored in it, for review. Content never changes the answer.
    pub seed: String,
    /// Whether committed content is still pending in the write-ahead log.
    pub wal: String,
    /// Prior-attempt corpus fixtures this fixture reproduces.
    pub ports: Vec<String>,
}

/// The complete checked manifest.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq)]
pub struct Manifest {
    /// Manifest format version.
    pub manifest_version: u32,
    /// The program that generated it.
    pub generated_by: String,
    /// The generation a directly adoptable installation reproduces.
    pub current_generation: String,
    /// Apps whose migration history belongs to the product.
    pub product_apps: Vec<String>,
    /// Known non-product migrations, so an unknown ledger row is refusable.
    pub framework_migrations: BTreeMap<String, Vec<String>>,
    /// The product migration graph, by app.
    pub migration_graph: BTreeMap<String, Vec<MigrationStep>>,
    /// Every supported generation.
    pub generations: Vec<Generation>,
    /// Every fixture the corpus materializes.
    pub corpus: Vec<CorpusFixture>,
    /// Semantic facts of the current generation, for named refusals.
    pub current_tables: BTreeMap<String, TableFacts>,
}

impl Manifest {
    /// The generation a directly adoptable installation reproduces.
    #[must_use]
    pub fn current(&self) -> &Generation {
        self.generation(&self.current_generation)
            .expect("the checked manifest records its current generation")
    }

    /// Look one generation up by name.
    #[must_use]
    pub fn generation(&self, name: &str) -> Option<&Generation> {
        self.generations
            .iter()
            .find(|generation| generation.name == name)
    }

    /// Look one generation up by the exact set of applied product migrations.
    #[must_use]
    pub fn generation_for(&self, applied: &BTreeSet<String>) -> Option<&Generation> {
        self.generations.iter().find(|generation| {
            generation.applied.len() == applied.len()
                && generation.applied.iter().all(|name| applied.contains(name))
        })
    }

    /// Whether `app.name` is a product migration this release knows.
    #[must_use]
    pub fn knows_product_migration(&self, app: &str, name: &str) -> bool {
        self.migration_graph
            .get(app)
            .is_some_and(|steps| steps.iter().any(|step| step.name == name))
    }

    /// Whether `app.name` is a framework migration this release knows.
    #[must_use]
    pub fn knows_framework_migration(&self, app: &str, name: &str) -> bool {
        self.framework_migrations
            .get(app)
            .is_some_and(|names| names.iter().any(|known| known == name))
    }

    /// Product migrations that `applied` requires but does not contain.
    ///
    /// A supported installation's ledger is closed under its own dependencies.
    /// Anything else is a partially applied migration run, which must be
    /// refused rather than bridged from an unknown midpoint.
    #[must_use]
    pub fn missing_dependencies(&self, applied: &BTreeSet<String>) -> Vec<String> {
        let mut missing = BTreeSet::new();
        for (app, steps) in &self.migration_graph {
            for step in steps {
                if !applied.contains(&format!("{app}.{}", step.name)) {
                    continue;
                }
                for [dependency_app, dependency_name] in &step.dependencies {
                    if !self
                        .product_apps
                        .iter()
                        .any(|known| known == dependency_app)
                    {
                        continue;
                    }
                    let required = format!("{dependency_app}.{dependency_name}");
                    if !applied.contains(&required) {
                        missing.insert(required);
                    }
                }
            }
        }
        missing.into_iter().collect()
    }

    /// Name the first current-generation table that disagrees with `observed`.
    #[must_use]
    pub fn current_mismatch(&self, observed: &ProductSchema) -> Option<String> {
        for (name, expected) in &self.current_tables {
            match observed.get(name) {
                None => return Some(format!("{name}: required table is missing")),
                Some(actual) if actual != expected => {
                    return Some(format!(
                        "{name}: {}",
                        super::schema_facts::difference(expected, actual)
                    ));
                }
                Some(_) => {}
            }
        }
        observed
            .keys()
            .find(|name| !self.current_tables.contains_key(*name))
            .map(|name| format!("{name}: unknown table in a product namespace"))
    }
}

/// The embedded checked manifest.
///
/// # Panics
///
/// Panics only when the generated manifest is malformed, which the manifest
/// tests turn into a source-tree failure rather than a runtime one.
#[must_use]
pub fn manifest() -> &'static Manifest {
    static MANIFEST: OnceLock<Manifest> = OnceLock::new();
    MANIFEST.get_or_init(|| {
        serde_json::from_str(include_str!("manifest.v1.json"))
            .expect("the checked installation manifest must deserialize")
    })
}

#[cfg(test)]
mod tests {
    use std::collections::BTreeSet;

    use super::manifest;

    #[test]
    fn every_recorded_generation_is_uniquely_identified_by_its_ledger() {
        let manifest = manifest();
        let mut seen = BTreeSet::new();
        for generation in &manifest.generations {
            let applied = generation.applied.iter().cloned().collect::<BTreeSet<_>>();
            assert_eq!(
                applied.len(),
                generation.applied.len(),
                "{} records a migration twice",
                generation.name
            );
            assert!(
                seen.insert(generation.applied.clone()),
                "{} shares its applied migrations with another generation",
                generation.name
            );
        }
    }

    #[test]
    fn the_current_generation_applies_every_product_migration() {
        let manifest = manifest();
        let current = manifest.current();
        let applied = current.applied.iter().cloned().collect::<BTreeSet<_>>();
        for (app, steps) in &manifest.migration_graph {
            for step in steps {
                assert!(
                    applied.contains(&format!("{app}.{}", step.name)),
                    "the current generation is missing {app}.{}",
                    step.name
                );
            }
        }
        assert_eq!(current.expected, "adopt");
        assert!(manifest.missing_dependencies(&applied).is_empty());
    }

    #[test]
    fn the_prior_adoption_corpus_is_reproduced_in_full() {
        let manifest = manifest();
        let ported = manifest
            .generations
            .iter()
            .flat_map(|generation| generation.ports.iter())
            .chain(
                manifest
                    .corpus
                    .iter()
                    .flat_map(|fixture| fixture.ports.iter()),
            )
            .cloned()
            .collect::<BTreeSet<_>>();
        assert_eq!(
            ported.len(),
            47,
            "the prior attempt's 47-database corpus must be reproduced, got {ported:?}"
        );
    }
}

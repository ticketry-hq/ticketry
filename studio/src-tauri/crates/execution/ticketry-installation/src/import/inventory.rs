use std::collections::BTreeMap;

use super::canonical::{digest, Cell};

#[derive(Clone, Debug, Default, Eq, PartialEq)]
pub(crate) struct Inventory {
    pub counts: BTreeMap<String, u64>,
    pub digests: BTreeMap<String, String>,
}

impl Inventory {
    pub fn record(&mut self, table: &str, rows: &[Vec<Cell>]) {
        self.counts.insert(table.to_owned(), rows.len() as u64);
        self.digests.insert(table.to_owned(), digest(rows));
    }

    #[must_use]
    pub fn total_rows(&self) -> u64 {
        self.counts.values().sum()
    }

    #[must_use]
    pub fn differences(&self, target: &Self) -> Vec<String> {
        let mut differences = Vec::new();
        for (table, source_count) in &self.counts {
            match target.counts.get(table) {
                Some(target_count) if target_count != source_count => differences.push(format!(
                    "{table}: {source_count} source row(s), {target_count} target row(s)"
                )),
                None => differences.push(format!("{table}: absent from the target inventory")),
                _ => {}
            }
            if self.digests.get(table) != target.digests.get(table) {
                differences.push(format!("{table}: canonical values differ"));
            }
        }
        differences
    }
}

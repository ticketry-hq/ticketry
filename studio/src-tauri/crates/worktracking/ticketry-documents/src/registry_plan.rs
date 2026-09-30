//! Comparing what a set of authorized roots holds against what the registry
//! says they hold.
//!
//! This is the only place discovery decides that something happened. Both the
//! full rescan and the watcher's per-path settlement build a plan here, so
//! "new document", "different bytes", and "file is gone" mean exactly one
//! thing in Ticketry regardless of which of them noticed.
//!
//! Everything is derived from the filesystem and the rows. Nothing is derived
//! from the event that brought us here — which is what makes a rescan after a
//! missed, dropped, or duplicated event produce the same registry as the event
//! stream would have.

use std::collections::{BTreeMap, BTreeSet};
use std::path::Path;

use ticketry_entities::design_document;

use super::authorized_roots;
use super::content_digest::digest_of;
use super::document_scan::scan_documents;
use super::registry_settlement::{ObservedDocument, RegistryPlan};

/// Compare every readable root against the rows that describe it.
///
/// `rows` is the whole bucket's registry, including rows whose root is no
/// longer readable: those files are gone from Ticketry's point of view and are
/// pruned, which is how a moved or deleted design directory stops claiming
/// documents that cannot be opened.
pub(super) fn plan_roots(
    roots: &BTreeSet<String>,
    rows: &[design_document::Model],
) -> RegistryPlan {
    let mut plan = RegistryPlan::default();
    let known = index_by_canonical_root(rows);

    // Two spellings of one directory are one root. Scanning both would register
    // every file twice and publish every change twice.
    let mut scanned: BTreeSet<String> = BTreeSet::new();
    for root in roots {
        let root = authorized_roots::canonical_root(root);
        if !authorized_roots::is_readable_root(&root) || !scanned.insert(root.clone()) {
            continue;
        }
        for rel_path in scan_documents(Path::new(&root)) {
            let digest = digest_of(&Path::new(&root).join(&rel_path));
            match known.get(&(root.clone(), rel_path.clone())) {
                None => plan.registered.push(ObservedDocument {
                    root_dir: root.clone(),
                    rel_path,
                    content_digest: digest,
                }),
                Some(row) => classify_existing(&mut plan, row, digest),
            }
        }
    }

    plan.removed = rows
        .iter()
        .filter(|row| !Path::new(&row.root_dir).join(&row.rel_path).is_file())
        .cloned()
        .collect();
    plan
}

/// Compare only the paths a watcher actually observed.
///
/// A design directory is small, but a burst of writes is not: rescanning the
/// whole root once per observed path would turn one agent writing ten files
/// into ten full walks. The observed paths are already validated and debounced,
/// so each is planned on its own — present with new bytes is a change, present
/// with no row is a registration, and absent is a removal.
pub(super) fn plan_paths(
    root: &str,
    rel_paths: &BTreeSet<String>,
    rows: &[design_document::Model],
) -> RegistryPlan {
    let mut plan = RegistryPlan::default();
    let root = &authorized_roots::canonical_root(root);
    let known = index_by_canonical_root(rows);

    for rel_path in rel_paths {
        let path = Path::new(root).join(rel_path);
        let row = known.get(&(root.clone(), rel_path.clone())).copied();
        // Containment is re-proved here rather than trusted from the event:
        // a path that now resolves outside its root is not a document, and a
        // row that claims it is pruned like any other missing file.
        let digest = contained(root, &path).then(|| digest_of(&path)).flatten();
        match (row, digest) {
            (None, Some(digest)) => plan.registered.push(ObservedDocument {
                root_dir: root.to_owned(),
                rel_path: rel_path.clone(),
                content_digest: Some(digest),
            }),
            (Some(row), Some(digest)) => classify_existing(&mut plan, row, Some(digest)),
            (Some(row), None) => plan.removed.push(row.clone()),
            (None, None) => {}
        }
    }
    plan
}

/// The rows a comparison looks up, keyed by the one canonical spelling of
/// their root. A row written under another spelling of the same directory is
/// the same row, so it is refreshed rather than duplicated.
fn index_by_canonical_root(
    rows: &[design_document::Model],
) -> BTreeMap<(String, String), &design_document::Model> {
    rows.iter()
        .map(|row| {
            (
                (
                    authorized_roots::canonical_root(&row.root_dir),
                    row.rel_path.clone(),
                ),
                row,
            )
        })
        .collect()
}

/// Whether a path's real location is still inside its authorized root.
fn contained(root: &str, path: &Path) -> bool {
    let (Ok(boundary), Ok(real)) = (Path::new(root).canonicalize(), path.canonicalize()) else {
        return false;
    };
    real.starts_with(&boundary) && real.is_file()
}

/// A registered document whose file is still there: unchanged, changed, or
/// carrying no fingerprint yet.
fn classify_existing(
    plan: &mut RegistryPlan,
    row: &design_document::Model,
    digest: Option<String>,
) {
    let Some(digest) = digest else {
        return;
    };
    match row.content_digest.as_deref() {
        Some(stored) if stored == digest => {}
        Some(_) => plan.changed.push((row.clone(), digest)),
        None => plan.backfilled.push((row.clone(), digest)),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn row(root: &Path, rel_path: &str, digest: Option<&str>) -> design_document::Model {
        design_document::Model {
            id: format!("id-{rel_path}"),
            module_id: "module".to_owned(),
            task_id: "task".to_owned(),
            scope: "task".to_owned(),
            root_dir: root.to_string_lossy().into_owned(),
            rel_path: rel_path.to_owned(),
            discovered_by_run_id: None,
            created_at: "2026-01-01T00:00:00Z".to_owned(),
            updated_at: "2026-01-01T00:00:00Z".to_owned(),
            content_digest: digest.map(str::to_owned),
        }
    }

    fn roots(root: &Path) -> BTreeSet<String> {
        BTreeSet::from([root.to_string_lossy().into_owned()])
    }

    #[test]
    fn an_unregistered_document_is_registered_with_the_bytes_it_holds() {
        let root = tempfile::tempdir().expect("create a design directory");
        std::fs::write(root.path().join("SPEC.md"), "# spec").expect("write the document");

        let plan = plan_roots(&roots(root.path()), &[]);

        assert_eq!(plan.registered.len(), 1);
        assert_eq!(plan.registered[0].rel_path, "SPEC.md");
        assert!(plan.registered[0].content_digest.is_some());
        assert!(plan.changed.is_empty() && plan.removed.is_empty());
    }

    #[test]
    fn a_document_whose_bytes_are_unchanged_plans_nothing_at_all() {
        let root = tempfile::tempdir().expect("create a design directory");
        std::fs::write(root.path().join("SPEC.md"), "# spec").expect("write the document");
        let digest = digest_of(&root.path().join("SPEC.md")).expect("digest the document");

        let plan = plan_roots(
            &roots(root.path()),
            &[row(root.path(), "SPEC.md", Some(&digest))],
        );

        assert!(plan.is_empty(), "a convergent rescan writes nothing");
    }

    #[test]
    fn rewritten_bytes_are_a_change_and_a_missing_fingerprint_is_only_a_backfill() {
        let root = tempfile::tempdir().expect("create a design directory");
        std::fs::write(root.path().join("SPEC.md"), "# spec").expect("write the document");
        std::fs::write(root.path().join("PLAN.md"), "# plan").expect("write the document");

        let plan = plan_roots(
            &roots(root.path()),
            &[
                row(root.path(), "SPEC.md", Some("an-older-digest")),
                row(root.path(), "PLAN.md", None),
            ],
        );

        assert_eq!(plan.changed.len(), 1);
        assert_eq!(plan.changed[0].0.rel_path, "SPEC.md");
        assert_eq!(plan.backfilled.len(), 1);
        assert_eq!(plan.backfilled[0].0.rel_path, "PLAN.md");
    }

    #[test]
    fn two_spellings_of_one_directory_are_one_root() {
        let root = tempfile::tempdir().expect("create a design directory");
        std::fs::write(root.path().join("SPEC.md"), "# spec").expect("write the document");
        let canonical = root.path().canonicalize().expect("canonicalize the root");
        // The same directory named twice: once as the run recorded it, once as
        // the canonical design directory resolves it.
        let spellings = BTreeSet::from([
            root.path().to_string_lossy().into_owned(),
            canonical
                .join("notes")
                .join("..")
                .to_string_lossy()
                .into_owned(),
        ]);

        let plan = plan_roots(&spellings, &[]);

        assert_eq!(
            plan.registered.len(),
            1,
            "one file under one directory is one registration, however it is spelled",
        );
    }

    #[test]
    fn observed_paths_are_planned_without_walking_the_rest_of_the_root() {
        let root = tempfile::tempdir().expect("create a design directory");
        std::fs::write(root.path().join("SPEC.md"), "# spec").expect("write the document");
        std::fs::write(root.path().join("UNTOUCHED.md"), "# other").expect("write the document");
        let key = root.path().to_string_lossy().into_owned();

        let plan = plan_paths(
            &key,
            &BTreeSet::from(["SPEC.md".to_owned(), "REMOVED.md".to_owned()]),
            &[row(root.path(), "REMOVED.md", Some("a-digest"))],
        );

        assert_eq!(plan.registered.len(), 1);
        assert_eq!(plan.registered[0].rel_path, "SPEC.md");
        assert_eq!(plan.removed.len(), 1);
        assert_eq!(plan.removed[0].rel_path, "REMOVED.md");
    }

    #[cfg(unix)]
    #[test]
    fn an_observed_path_that_escapes_its_root_is_not_a_document() {
        let outside = tempfile::tempdir().expect("create an outside directory");
        std::fs::write(outside.path().join("secret.md"), "secret").expect("write outside content");
        let root = tempfile::tempdir().expect("create a design directory");
        std::os::unix::fs::symlink(
            outside.path().join("secret.md"),
            root.path().join("escape.md"),
        )
        .expect("create the escaping symlink");

        let plan = plan_paths(
            &root.path().to_string_lossy().into_owned(),
            &BTreeSet::from(["escape.md".to_owned()]),
            &[],
        );

        assert!(plan.is_empty(), "an escaping path registers nothing");
    }

    #[test]
    fn a_row_whose_file_is_gone_is_removed_even_when_its_root_disappeared() {
        let root = tempfile::tempdir().expect("create a design directory");
        let absent = root.path().join("absent-root");

        let plan = plan_roots(
            &BTreeSet::from([absent.to_string_lossy().into_owned()]),
            &[row(&absent, "SPEC.md", Some("a-digest"))],
        );

        assert_eq!(plan.removed.len(), 1);
        assert!(plan.registered.is_empty());
    }
}

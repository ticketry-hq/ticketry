//! The canonical design-directory contract, computed without touching disk.
//!
//! Layout, relative to a module's configured local folder:
//!
//! - task run:     `spec/<module-slug>--<module-id8>/<KEY>--<task-slug>/`
//! - planning run: `spec/<module-slug>--<module-id8>/planning/<run-id8>/`
//!
//! The trailing identity components are authoritative for lookup and the slugs
//! are cosmetic, so renaming a module or a Work Item never orphans the
//! directory an agent already wrote into. Only [`resolve_task_design_dir`]
//! reads the filesystem, and it reads directory names alone.

use std::path::Path;

/// Slug budgets that keep directory names readable.
pub const MODULE_SLUG_MAX: usize = 24;
pub const TASK_SLUG_MAX: usize = 40;

pub const SPEC_ROOT: &str = "spec";
pub const PLANNING_SUBDIR: &str = "planning";

/// The Work Management facts a design directory name is derived from. Both are
/// resolved from owned data; neither is ever accepted from a caller.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ModuleIdentity {
    pub id: String,
    pub name: String,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct TaskIdentity {
    pub id: String,
    pub name: String,
    pub sequence_id: i32,
}

/// Reduce free text to a filesystem-safe lowercase slug: every run of
/// non-alphanumeric characters collapses to one dash, and the result is
/// trimmed and truncated without a trailing dash.
pub fn slugify(text: &str, max_len: usize) -> String {
    let lowered = text.to_lowercase();
    let mut slug = String::with_capacity(lowered.len());
    for character in lowered.chars() {
        if character.is_ascii_alphanumeric() {
            slug.push(character);
        } else if !slug.ends_with('-') {
            slug.push('-');
        }
    }
    let slug = slug.trim_matches('-');
    let truncated: String = slug.chars().take(max_len).collect();
    let truncated = truncated.trim_end_matches('-');
    if truncated.is_empty() {
        "untitled".to_owned()
    } else {
        truncated.to_owned()
    }
}

/// The first eight characters of an identity, which is what a directory name
/// carries as its rename-proof suffix.
fn identity_prefix(id: &str) -> String {
    id.chars().take(8).collect()
}

/// Directory name for a module: readable slug plus authoritative id suffix.
pub fn module_dir_name(module: &ModuleIdentity) -> String {
    format!(
        "{}--{}",
        slugify(&module.name, MODULE_SLUG_MAX),
        identity_prefix(&module.id)
    )
}

/// Stable, rename-proof key prefix for a task directory. The ticket sequence
/// is preferred; a Work Item without one falls back to its raw identity.
fn task_key(task: &TaskIdentity) -> String {
    if task.sequence_id != 0 {
        format!("T{}", task.sequence_id)
    } else {
        identity_prefix(&task.id)
    }
}

/// Directory name for a task: stable key plus readable slug.
pub fn task_dir_name(task: &TaskIdentity) -> String {
    format!("{}--{}", task_key(task), slugify(&task.name, TASK_SLUG_MAX))
}

/// Folder-relative canonical design directory for a task-bound run.
pub fn task_design_dir(module: &ModuleIdentity, task: &TaskIdentity) -> String {
    format!(
        "{SPEC_ROOT}/{}/{}",
        module_dir_name(module),
        task_dir_name(task)
    )
}

/// Folder-relative design directory for a planning or instant scratch run.
pub fn planning_design_dir(module: &ModuleIdentity, agent_run_id: &str) -> String {
    format!(
        "{SPEC_ROOT}/{}/{PLANNING_SUBDIR}/{}",
        module_dir_name(module),
        identity_prefix(agent_run_id)
    )
}

/// Resolve a task's design directory under `root`, reusing a renamed match.
///
/// Lookup uses the authoritative components only: any existing
/// `spec/*--<module-id8>/` directory matches the module, and inside it any
/// child beginning `<KEY>--` matches the task. A module or Work Item rename
/// therefore keeps pointing at the directory that already holds documents.
/// With no match the freshly computed canonical name is returned.
pub fn resolve_task_design_dir(
    root: &Path,
    module: &ModuleIdentity,
    task: &TaskIdentity,
) -> String {
    let Some(module_dir) = existing_module_dir(root, module) else {
        return task_design_dir(module, task);
    };
    let prefix = format!("{}--", task_key(task));
    if let Some(existing) = sorted_directory_names(&root.join(SPEC_ROOT).join(&module_dir))
        .into_iter()
        .find(|name| name.starts_with(&prefix))
    {
        return format!("{SPEC_ROOT}/{module_dir}/{existing}");
    }
    format!("{SPEC_ROOT}/{module_dir}/{}", task_dir_name(task))
}

fn existing_module_dir(root: &Path, module: &ModuleIdentity) -> Option<String> {
    let suffix = format!("--{}", identity_prefix(&module.id));
    sorted_directory_names(&root.join(SPEC_ROOT))
        .into_iter()
        .find(|name| name.ends_with(&suffix))
}

/// Immediate child directory names, sorted, so resolution is deterministic
/// when more than one directory could match.
fn sorted_directory_names(directory: &Path) -> Vec<String> {
    let Ok(entries) = std::fs::read_dir(directory) else {
        return Vec::new();
    };
    let mut names: Vec<String> = entries
        .flatten()
        .filter(|entry| entry.path().is_dir())
        .filter_map(|entry| entry.file_name().into_string().ok())
        .collect();
    names.sort();
    names
}

#[cfg(test)]
mod tests {
    use super::*;

    fn module() -> ModuleIdentity {
        ModuleIdentity {
            id: "cf2de16d-efbd-4106-b0e4-ceab58b90b22".to_owned(),
            name: "Platform Runtime".to_owned(),
        }
    }

    fn task() -> TaskIdentity {
        TaskIdentity {
            id: "877e1c31-1554-4c8c-aec7-219aa2f5abfb".to_owned(),
            name: "Discover and render authorized documents".to_owned(),
            sequence_id: 758,
        }
    }

    #[test]
    fn slugs_collapse_punctuation_and_survive_nothing_usable() {
        assert_eq!(
            slugify("Platform Runtime", MODULE_SLUG_MAX),
            "platform-runtime"
        );
        assert_eq!(slugify("  ***  ", MODULE_SLUG_MAX), "untitled");
        assert_eq!(slugify("a".repeat(60).as_str(), TASK_SLUG_MAX).len(), 40);
        assert_eq!(slugify("Design/Doc — v2", TASK_SLUG_MAX), "design-doc-v2");
    }

    #[test]
    fn a_truncated_slug_never_keeps_a_trailing_dash() {
        assert_eq!(slugify("abcdefgh ijkl", 9), "abcdefgh");
    }

    #[test]
    fn directory_names_carry_the_rename_proof_identity() {
        assert_eq!(module_dir_name(&module()), "platform-runtime--cf2de16d");
        assert_eq!(
            task_dir_name(&task()),
            "T758--discover-and-render-authorized-documents"
        );
        assert_eq!(
            task_design_dir(&module(), &task()),
            "spec/platform-runtime--cf2de16d/T758--discover-and-render-authorized-documents"
        );
    }

    #[test]
    fn a_work_item_without_a_ticket_sequence_falls_back_to_its_identity() {
        let unsequenced = TaskIdentity {
            sequence_id: 0,
            ..task()
        };

        assert!(task_dir_name(&unsequenced).starts_with("877e1c31--"));
    }

    #[test]
    fn planning_directories_are_scoped_by_run_identity() {
        assert_eq!(
            planning_design_dir(&module(), "3f2a91c4bbbb4d0e8a1f0d2c3b4a5968"),
            "spec/platform-runtime--cf2de16d/planning/3f2a91c4"
        );
    }

    #[test]
    fn renamed_module_and_task_directories_still_resolve() {
        let root = tempfile::tempdir().expect("create a module folder");
        let existing = root
            .path()
            .join(SPEC_ROOT)
            .join("old-module-name--cf2de16d")
            .join("T758--an-older-title");
        std::fs::create_dir_all(&existing).expect("create the existing design directory");

        assert_eq!(
            resolve_task_design_dir(root.path(), &module(), &task()),
            "spec/old-module-name--cf2de16d/T758--an-older-title"
        );
    }

    #[test]
    fn an_unseen_task_lands_in_the_existing_module_directory() {
        let root = tempfile::tempdir().expect("create a module folder");
        std::fs::create_dir_all(root.path().join(SPEC_ROOT).join("old-name--cf2de16d"))
            .expect("create the existing module directory");

        assert_eq!(
            resolve_task_design_dir(root.path(), &module(), &task()),
            "spec/old-name--cf2de16d/T758--discover-and-render-authorized-documents"
        );
    }

    #[test]
    fn an_empty_folder_resolves_to_the_canonical_layout() {
        let root = tempfile::tempdir().expect("create a module folder");

        assert_eq!(
            resolve_task_design_dir(root.path(), &module(), &task()),
            task_design_dir(&module(), &task())
        );
    }
}

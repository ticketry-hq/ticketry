use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::OnceLock;

pub const BRANCH: &str = "wt/CODIN-881-parent-story";
const CHECKOUT_NAME: &str = "CODIN-881-parent-story";

#[derive(Clone, Copy)]
pub enum Scenario {
    Clean,
    Dirty,
    Diverged,
    Conflict,
}

#[derive(Debug, Eq, PartialEq)]
struct CheckoutSnapshot {
    head: String,
    merge_head: Option<String>,
    status: String,
    diff: String,
    index: String,
}

#[derive(Debug, Eq, PartialEq)]
pub struct RepositorySnapshot {
    refs: String,
    registered_worktrees: String,
    primary: CheckoutSnapshot,
    task: Option<CheckoutSnapshot>,
}

pub struct GitFixture {
    repository: PathBuf,
    checkout: PathBuf,
    base_commit: String,
}

impl GitFixture {
    pub fn new(directory: &Path, scenario: Scenario) -> Self {
        let repository = directory
            .join("repositories")
            .join(unique_repository_name());
        let base_commit = initialize_repository(&repository);
        let checkout = checkout_base()
            .join(repository.file_name().expect("repository name"))
            .join(CHECKOUT_NAME);
        std::fs::create_dir_all(checkout.parent().expect("checkout parent"))
            .expect("create checkout parent");
        git(
            &[
                "worktree",
                "add",
                "-b",
                BRANCH,
                &checkout.display().to_string(),
                &base_commit,
            ],
            &repository,
        );
        arrange_scenario(scenario, &repository, &checkout);
        Self {
            repository,
            checkout,
            base_commit,
        }
    }

    pub fn repository(&self) -> &Path {
        &self.repository
    }

    pub fn checkout(&self) -> &Path {
        &self.checkout
    }

    pub fn base_commit(&self) -> &str {
        &self.base_commit
    }

    pub fn snapshot(&self) -> RepositorySnapshot {
        RepositorySnapshot {
            refs: git(
                &["for-each-ref", "--format=%(refname)%00%(objectname)"],
                &self.repository,
            ),
            registered_worktrees: git(&["worktree", "list", "--porcelain"], &self.repository),
            primary: checkout_snapshot(&self.repository),
            task: self
                .checkout
                .exists()
                .then(|| checkout_snapshot(&self.checkout)),
        }
    }

    pub fn checkout_is_openable(&self) -> bool {
        let Some(root) = git_output(&["rev-parse", "--show-toplevel"], &self.checkout) else {
            return false;
        };
        PathBuf::from(root).canonicalize().ok() == self.checkout.canonicalize().ok()
    }

    pub fn read_checkout(&self, relative_path: &str) -> String {
        std::fs::read_to_string(self.checkout.join(relative_path)).expect("read retained checkout")
    }

    pub fn branch_exists(&self) -> bool {
        git_output(
            &["rev-parse", &format!("refs/heads/{BRANCH}")],
            &self.repository,
        )
        .is_some()
    }
}

fn arrange_scenario(scenario: Scenario, repository: &Path, checkout: &Path) {
    match scenario {
        Scenario::Clean => {}
        Scenario::Dirty => write(&checkout.join("README.md"), "unfinished work\n"),
        Scenario::Diverged => {
            commit(checkout, "task.txt", "task side\n", "task side");
            commit(repository, "base.txt", "base side\n", "base side");
        }
        Scenario::Conflict => {
            commit(checkout, "README.md", "task side\n", "task side");
            commit(repository, "README.md", "base side\n", "base side");
            git_fails(&["merge", "main"], checkout);
        }
    }
}

fn checkout_snapshot(checkout: &Path) -> CheckoutSnapshot {
    CheckoutSnapshot {
        head: git(&["rev-parse", "HEAD"], checkout),
        merge_head: git_output(&["rev-parse", "--verify", "MERGE_HEAD"], checkout),
        status: git(
            &["status", "--porcelain=v1", "--untracked-files=all"],
            checkout,
        ),
        diff: git(&["diff", "--binary", "HEAD"], checkout),
        index: git(&["ls-files", "--stage"], checkout),
    }
}

fn checkout_base() -> &'static Path {
    static BASE: OnceLock<tempfile::TempDir> = OnceLock::new();
    BASE.get_or_init(|| {
        let base = tempfile::tempdir().expect("create shared checkout base");
        std::env::set_var("MUXED_WORKTREES_DIR", base.path());
        base
    })
    .path()
}

fn unique_repository_name() -> String {
    static NEXT: AtomicUsize = AtomicUsize::new(0);
    format!("ticketry-{}", NEXT.fetch_add(1, Ordering::Relaxed))
}

fn initialize_repository(root: &Path) -> String {
    std::fs::create_dir_all(root).expect("create repository directory");
    git(&["init", "-b", "main"], root);
    git(&["config", "user.email", "test@ticketry.invalid"], root);
    git(&["config", "user.name", "Ticketry Test"], root);
    commit(root, "README.md", "base\n", "base")
}

fn commit(checkout: &Path, path: &str, contents: &str, message: &str) -> String {
    write(&checkout.join(path), contents);
    git(&["add", path], checkout);
    git(&["commit", "-m", message], checkout);
    git(&["rev-parse", "HEAD"], checkout)
}

fn write(path: &Path, contents: &str) {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).expect("create fixture directory");
    }
    std::fs::write(path, contents).expect("write fixture file");
}

fn git(arguments: &[&str], working_directory: &Path) -> String {
    let output = git_command(arguments, working_directory)
        .output()
        .expect("run git");
    assert!(
        output.status.success(),
        "git {arguments:?} failed: {}",
        String::from_utf8_lossy(&output.stderr)
    );
    String::from_utf8_lossy(&output.stdout).trim().to_owned()
}

fn git_output(arguments: &[&str], working_directory: &Path) -> Option<String> {
    let output = git_command(arguments, working_directory)
        .output()
        .expect("run git");
    output
        .status
        .success()
        .then(|| String::from_utf8_lossy(&output.stdout).trim().to_owned())
}

fn git_fails(arguments: &[&str], working_directory: &Path) {
    let output = git_command(arguments, working_directory)
        .output()
        .expect("run git");
    assert!(
        !output.status.success(),
        "git {arguments:?} unexpectedly succeeded"
    );
}

fn git_command(arguments: &[&str], working_directory: &Path) -> Command {
    let mut command = Command::new("git");
    command
        .arg("-C")
        .arg(working_directory)
        .args(arguments)
        .env("GIT_AUTHOR_NAME", "Ticketry Test")
        .env("GIT_AUTHOR_EMAIL", "test@ticketry.invalid")
        .env("GIT_COMMITTER_NAME", "Ticketry Test")
        .env("GIT_COMMITTER_EMAIL", "test@ticketry.invalid");
    command
}

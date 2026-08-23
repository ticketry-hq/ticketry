//! What a preflight run is allowed to say, and what it must never say.
//!
//! A refusal has to be actionable: the user needs to know which rule the
//! installation broke, how many rows broke it, and which rows to look at. It
//! must not become a disclosure channel, so a report carries stable identities
//! and counts only. Credentials, prompts, provider commands, captured output,
//! and secret-bearing configuration never enter it, and a path is represented
//! by a short digest rather than its text.
//!
//! Preflight never repairs. A defect it can explain is still a defect; only a
//! named, versioned bridge may admit one, and the admission is recorded here
//! beside the defect it covers.

use std::fmt::Write as _;

use serde::Serialize;
use sha2::{Digest, Sha256};

use crate::installation_classification::Engine;

/// How many affected identities one defect reports before it truncates.
///
/// A defect is actionable from a handful of examples plus an exact count. A
/// full list of every affected row would turn a report into a bulk extract of
/// the installation's identifiers.
pub const REPORTED_IDENTITIES: usize = 10;

/// One broken rule, with the evidence needed to act on it.
#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Defect {
    /// The stable machine-readable rule name.
    pub code: String,
    /// Which capability the rule belongs to, for grouping a report.
    pub area: Area,
    /// The rule in one operator-safe sentence.
    pub rule: String,
    /// How many rows break it.
    pub count: u64,
    /// The first [`REPORTED_IDENTITIES`] affected identities, sorted.
    pub affected: Vec<String>,
    /// Whether [`Defect::affected`] omits further identities.
    pub truncated: bool,
    /// The named, versioned bridge admitting this defect, when one exists.
    pub admitted_by: Option<String>,
}

impl Defect {
    /// Whether a bridge admits this defect, making it repairable rather than
    /// a refusal.
    #[must_use]
    pub const fn is_admitted(&self) -> bool {
        self.admitted_by.is_some()
    }
}

/// Which part of the installation a rule belongs to.
#[derive(Clone, Copy, Debug, Eq, Ord, PartialEq, PartialOrd, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum Area {
    /// Storage-level integrity and declared foreign keys.
    Structure,
    /// Projects, Work Items, workflow, dependencies, ranks, revisions.
    WorkManagement,
    /// Settings, Runs, events, documents, worktrees, graph, terminals.
    Capability,
    /// Durable effect and reconciliation history.
    EffectHistory,
    /// Recorded paths and the roots they are authorized against.
    Filesystem,
    /// tmux session names and runtime namespaces, checked as data.
    Runtime,
}

impl Area {
    const fn label(self) -> &'static str {
        match self {
            Self::Structure => "structure",
            Self::WorkManagement => "work management",
            Self::Capability => "capability",
            Self::EffectHistory => "effect history",
            Self::Filesystem => "filesystem",
            Self::Runtime => "runtime",
        }
    }
}

/// A rule that could not apply, and why.
///
/// Historical generations do not carry every table, so most rules are simply
/// not applicable to most installations. Recording that is what makes a clean
/// report meaningful: it distinguishes a rule that passed from one that never
/// ran.
#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Skipped {
    /// The rule that did not run.
    pub code: String,
    /// The `table` or `table.column` it needs, which this generation lacks.
    pub missing_requirement: String,
}

/// The verdict on one installation.
#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum Verdict {
    /// Every applicable rule passed. Adoption may proceed.
    Adoptable,
    /// Every defect found is admitted by a named bridge.
    AdoptableThroughBridge,
    /// At least one defect has no bridge. Adoption stops here.
    Refused,
}

/// The complete result of one read-only preflight run.
#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PreflightReport {
    /// The engine the installation is stored in.
    pub engine: Engine,
    /// The classified generation preflight ran against.
    pub generation: String,
    /// How many rules applied to this installation.
    pub checked: usize,
    /// Rules this generation has no table for.
    pub skipped: Vec<Skipped>,
    /// Every broken rule, ordered by area then code.
    pub defects: Vec<Defect>,
}

impl PreflightReport {
    /// The verdict, derived from the defects and their admissions.
    #[must_use]
    pub fn verdict(&self) -> Verdict {
        if self.defects.is_empty() {
            Verdict::Adoptable
        } else if self.defects.iter().all(Defect::is_admitted) {
            Verdict::AdoptableThroughBridge
        } else {
            Verdict::Refused
        }
    }

    /// Whether adoption must stop.
    #[must_use]
    pub fn refuses(&self) -> bool {
        self.verdict() == Verdict::Refused
    }

    /// The bridges this installation would need, in a stable order.
    #[must_use]
    pub fn required_bridges(&self) -> Vec<String> {
        let mut bridges = self
            .defects
            .iter()
            .filter_map(|defect| defect.admitted_by.clone())
            .collect::<Vec<_>>();
        bridges.sort();
        bridges.dedup();
        bridges
    }

    /// Render the report as the text a user is shown or a supporter is sent.
    ///
    /// Everything in the rendering comes from [`Defect`] fields, which already
    /// exclude content. There is deliberately no path, prompt, command, or
    /// configuration value to render.
    #[must_use]
    pub fn render(&self) -> String {
        let mut text = String::new();
        let verdict = match self.verdict() {
            Verdict::Adoptable => "safe to adopt",
            Verdict::AdoptableThroughBridge => "adoptable only through a bridge",
            Verdict::Refused => "refused",
        };
        let _ = writeln!(
            text,
            "Installation preflight: {verdict} ({} rules checked, {} not applicable)",
            self.checked,
            self.skipped.len()
        );
        let _ = writeln!(
            text,
            "  source: {} on {}",
            self.generation,
            match self.engine {
                Engine::Sqlite => "sqlite",
                Engine::Postgresql => "postgresql",
            }
        );
        for defect in &self.defects {
            let _ = writeln!(
                text,
                "  [{}] {} — {} affected: {}",
                defect.area.label(),
                defect.code,
                defect.count,
                defect.rule
            );
            if !defect.affected.is_empty() {
                let _ = writeln!(
                    text,
                    "      {}{}",
                    defect.affected.join(", "),
                    if defect.truncated { ", …" } else { "" }
                );
            }
            if let Some(bridge) = &defect.admitted_by {
                let _ = writeln!(text, "      admitted by bridge {bridge}");
            }
        }
        if self.refuses() {
            let _ = writeln!(
                text,
                "  Nothing was changed. The installation is unchanged and reusable."
            );
        }
        text
    }
}

/// The reported stand-in for a path.
///
/// A path is often the most sensitive value in an installation: it names
/// repositories, clients, and people. Support still needs to tell two offending
/// paths apart and to confirm that a path the user reads out is the one the
/// report meant, so a path is reported as a short digest of its exact bytes.
#[must_use]
pub fn path_identity(path: &str) -> String {
    let digest = Sha256::digest(path.as_bytes());
    format!(
        "path:{}",
        digest[..6]
            .iter()
            .map(|byte| format!("{byte:02x}"))
            .collect::<String>()
    )
}

#[cfg(test)]
mod tests {
    use super::{path_identity, Area, Defect, Engine, PreflightReport, Verdict};

    fn defect(code: &str, admitted_by: Option<&str>) -> Defect {
        Defect {
            code: code.to_owned(),
            area: Area::WorkManagement,
            rule: "a rule".to_owned(),
            count: 1,
            affected: vec!["0000".to_owned()],
            truncated: false,
            admitted_by: admitted_by.map(str::to_owned),
        }
    }

    fn report(defects: Vec<Defect>) -> PreflightReport {
        PreflightReport {
            engine: Engine::Sqlite,
            generation: "django-current".to_owned(),
            checked: 3,
            skipped: Vec::new(),
            defects,
        }
    }

    #[test]
    fn a_clean_report_is_adoptable() {
        assert_eq!(report(Vec::new()).verdict(), Verdict::Adoptable);
    }

    #[test]
    fn one_unadmitted_defect_refuses_even_beside_admitted_ones() {
        let mixed = report(vec![
            defect("admitted", Some("bridge-a.v1")),
            defect("unknown", None),
        ]);
        assert_eq!(mixed.verdict(), Verdict::Refused);
        assert!(mixed.refuses());
    }

    #[test]
    fn fully_admitted_defects_name_their_bridges_without_refusing() {
        let admitted = report(vec![
            defect("second", Some("bridge-b.v1")),
            defect("first", Some("bridge-a.v1")),
            defect("third", Some("bridge-a.v1")),
        ]);
        assert_eq!(admitted.verdict(), Verdict::AdoptableThroughBridge);
        assert!(!admitted.refuses());
        assert_eq!(admitted.required_bridges(), ["bridge-a.v1", "bridge-b.v1"]);
    }

    #[test]
    fn a_path_identity_is_stable_and_reveals_no_path() {
        let path = "/Users/someone/clients/acme/secret-repo";
        assert_eq!(path_identity(path), path_identity(path));
        assert_ne!(path_identity(path), path_identity("/Users/someone"));
        assert!(!path_identity(path).contains("acme"));
    }
}

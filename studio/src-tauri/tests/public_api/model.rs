use std::collections::BTreeMap;
use std::path::PathBuf;

#[derive(Debug, Default)]
pub struct Program {
    pub crates: BTreeMap<String, Crate>,
    pub modules: Vec<Module>,
    pub diagnostics: Vec<String>,
}

#[derive(Debug)]
pub struct Crate {
    pub root: usize,
    pub dependencies: BTreeMap<String, String>,
}

#[derive(Debug)]
pub struct CrateInput {
    pub name: String,
    pub root: PathBuf,
    pub dependencies: BTreeMap<String, String>,
}

#[derive(Debug)]
pub struct Module {
    pub crate_name: String,
    pub parent: Option<usize>,
    pub symbols: BTreeMap<String, Vec<Binding>>,
    pub source: PathBuf,
    pub logical_path: Vec<String>,
    pub expansions: Vec<String>,
    pub macro_references: Vec<(Vec<String>, Vec<String>)>,
    pub glob_imports: Vec<Vec<String>>,
    pub opaque_macro_scope: bool,
    pub reviewed_local_macros: Vec<String>,
    pub body_bindings: Vec<String>,
    pub opaque_body_imports: bool,
}

#[derive(Clone, Debug)]
pub struct Binding {
    pub public: bool,
    pub kind: BindingKind,
    pub gates: Vec<String>,
    pub source: String,
}

#[derive(Clone, Debug)]
pub enum BindingKind {
    Leaf(String),
    Module(usize),
    Use { path: Vec<String>, absolute: bool },
    Crate(String),
    Glob,
}

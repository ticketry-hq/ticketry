#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum CatalogRefreshPolicy {
    PersistedDatabase,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct ModelDefinition {
    pub name: &'static str,
    pub efforts: &'static [&'static str],
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct InstallationCatalog {
    pub active_by_default: bool,
    pub models: &'static [ModelDefinition],
    pub default_model: Option<&'static str>,
    pub default_effort: Option<&'static str>,
}

pub(crate) fn efforts_for(
    catalog: &'static InstallationCatalog,
    model: &str,
) -> Option<&'static [&'static str]> {
    catalog
        .models
        .iter()
        .find(|candidate| candidate.name == model)
        .map(|candidate| candidate.efforts)
}

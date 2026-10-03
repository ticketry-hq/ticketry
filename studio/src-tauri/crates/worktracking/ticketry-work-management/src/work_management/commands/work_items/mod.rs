mod archive;
mod create;
mod delete;
mod revision;
mod update;
mod validation;

pub use super::descriptions::{append_description, AppendDescription};
pub use super::review_findings::{create_review_finding, CreateReviewFinding};
pub use archive::archive;
pub use create::create;
pub(crate) use create::create_in;
pub use delete::delete;
pub use revision::next_revision;
pub use update::update;
pub(super) use validation::valid_name;

#[derive(Debug, Clone)]
pub struct CreateWorkItem {
    pub project_id: String,
    pub name: String,
    pub issue_type_id: String,
    pub description: Option<String>,
    pub state_id: Option<String>,
    pub parent_id: Option<String>,
}

#[derive(Debug, Clone)]
pub struct UpdateWorkItem {
    pub id: String,
    pub name: Option<String>,
    pub description: Option<String>,
    pub issue_type_id: Option<String>,
}

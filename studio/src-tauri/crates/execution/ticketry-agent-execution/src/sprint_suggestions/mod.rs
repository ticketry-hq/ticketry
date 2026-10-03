mod create;
#[cfg(test)]
mod graphql_tests;
mod output;
mod process;
#[cfg(test)]
mod process_tests;
mod publication;
#[cfg(test)]
mod publication_tests;
mod snapshot;
#[cfg(test)]
mod test_fixture;
#[cfg(test)]
mod tests;
mod views;
mod worker;

use sea_orm::DatabaseConnection;
use std::path::PathBuf;

#[derive(Clone)]
pub struct SprintSuggestionExecutor {
    database: DatabaseConnection,
    directory: PathBuf,
    #[cfg(test)]
    program: Option<PathBuf>,
}
impl SprintSuggestionExecutor {
    pub fn new(database: DatabaseConnection, directory: PathBuf) -> Self {
        Self {
            database,
            directory,
            #[cfg(test)]
            program: None,
        }
    }
    pub(crate) fn executable(&self) -> Result<PathBuf, String> {
        #[cfg(test)]
        if let Some(program) = &self.program {
            return Ok(program.clone());
        }
        process::executable()
    }
    pub async fn recover(&self) -> Result<(), sea_orm::DbErr> {
        worker::recover(&self.database).await
    }
}
pub fn register_sprint_execution_graphql(builder: seaography::Builder) -> seaography::Builder {
    views::register(builder)
}

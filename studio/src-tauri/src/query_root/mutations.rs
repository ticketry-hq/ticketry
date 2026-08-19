pub(crate) mod patch_input;
pub(crate) mod work_management;
pub(crate) mod workflow_configuration;

use crate::entities::work_management as entities;
use crate::query_root::types as read_types;
use crate::work_management::commands;

use patch_input as graphql_patch_input;
use work_management as command_schema;

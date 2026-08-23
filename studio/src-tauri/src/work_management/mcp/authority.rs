use std::collections::{BTreeSet, HashMap};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use base64::Engine;
use sea_orm::EntityTrait;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};

use crate::entities::runs::agent_run;
use crate::work_management::entities::issue;

const AUTHORITY_LIFETIME: Duration = Duration::from_secs(24 * 60 * 60);

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct RunPrincipal {
    pub agent_run_id: String,
    pub issue_id: String,
    pub project_id: String,
    pub scope: String,
}

#[derive(Clone)]
pub struct RunAuthority {
    database: sea_orm::DatabaseConnection,
    grants: Arc<Mutex<HashMap<[u8; 32], Grant>>>,
}

#[derive(Clone)]
struct Grant {
    agent_run_id: String,
    allowed_tools: BTreeSet<String>,
    expires_at: Instant,
}

#[derive(Debug)]
pub struct AuthorizationFailure(pub Value);

impl RunAuthority {
    pub fn new(database: sea_orm::DatabaseConnection) -> Self {
        Self {
            database,
            grants: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    pub async fn issue(
        &self,
        agent_run_id: &str,
        allowed_tools: impl IntoIterator<Item = String>,
    ) -> Result<String, AuthorizationFailure> {
        let run = self.active_run(agent_run_id).await?;
        let mut bytes = [0_u8; 32];
        rand::RngCore::fill_bytes(&mut rand::thread_rng(), &mut bytes);
        let token = base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(bytes);
        self.grants
            .lock()
            .expect("run authority lock poisoned")
            .insert(
                digest(&token),
                Grant {
                    agent_run_id: run.id,
                    allowed_tools: allowed_tools.into_iter().collect(),
                    expires_at: Instant::now() + AUTHORITY_LIFETIME,
                },
            );
        Ok(format!("Bearer {token}"))
    }

    pub async fn authorize(
        &self,
        authorization: Option<&str>,
        tool: &str,
    ) -> Result<RunPrincipal, AuthorizationFailure> {
        let (principal, grant) = self.authenticate_grant(authorization).await?;
        if !grant.allowed_tools.contains(tool) {
            return Err(failure("tool_not_allowed", "authorization_tool_disallowed"));
        }
        Ok(principal)
    }

    pub async fn authenticate(
        &self,
        authorization: Option<&str>,
    ) -> Result<RunPrincipal, AuthorizationFailure> {
        self.authenticate_grant(authorization)
            .await
            .map(|(principal, _)| principal)
    }

    async fn authenticate_grant(
        &self,
        authorization: Option<&str>,
    ) -> Result<(RunPrincipal, Grant), AuthorizationFailure> {
        let token = bearer_token(authorization)?;
        let grant = self
            .grants
            .lock()
            .expect("run authority lock poisoned")
            .get(&digest(token))
            .cloned()
            .ok_or_else(|| failure("caller_run_unbound", "authorization_invalid"))?;
        if grant.expires_at <= Instant::now() {
            return Err(failure("caller_run_unbound", "authorization_expired"));
        }
        let principal = self.principal(&grant.agent_run_id).await?;
        Ok((principal, grant))
    }

    pub async fn authorize_run(
        &self,
        authorization: Option<&str>,
        claimed_run_id: &str,
    ) -> Result<RunPrincipal, AuthorizationFailure> {
        let principal = self.authorize(authorization, "provider_lifecycle").await?;
        if principal.agent_run_id != claimed_run_id {
            return Err(failure("caller_run_unbound", "authorization_foreign_run"));
        }
        Ok(principal)
    }

    async fn active_run(
        &self,
        agent_run_id: &str,
    ) -> Result<agent_run::Model, AuthorizationFailure> {
        agent_run::Entity::find_by_id(agent_run_id)
            .one(&self.database)
            .await
            .map_err(|_| failure("run_control_unavailable", "authorization_unavailable"))?
            .ok_or_else(|| failure("caller_run_unknown", "caller_run_unknown"))
            .and_then(|run| {
                if run.ended_at.is_some() {
                    Err(failure("caller_run_unbound", "caller_run_inactive"))
                } else {
                    Ok(run)
                }
            })
    }

    async fn principal(&self, agent_run_id: &str) -> Result<RunPrincipal, AuthorizationFailure> {
        let run = self.active_run(agent_run_id).await?;
        let item = issue::Entity::find_by_id(&run.issue_id)
            .one(&self.database)
            .await
            .map_err(|_| failure("run_control_unavailable", "authorization_unavailable"))?
            .ok_or_else(|| failure("caller_run_unknown", "caller_run_unknown"))?;
        Ok(RunPrincipal {
            agent_run_id: run.id,
            issue_id: public_id(&run.issue_id),
            project_id: public_id(&item.project_id),
            scope: run.scope,
        })
    }

    #[cfg(test)]
    pub async fn grant_for_test(
        &self,
        agent_run_id: &str,
        token: &str,
        allowed_tools: impl IntoIterator<Item = String>,
        expired: bool,
    ) -> Result<String, AuthorizationFailure> {
        let run = self.active_run(agent_run_id).await?;
        self.grants
            .lock()
            .expect("run authority lock poisoned")
            .insert(
                digest(token),
                Grant {
                    agent_run_id: run.id,
                    allowed_tools: allowed_tools.into_iter().collect(),
                    expires_at: if expired {
                        Instant::now()
                    } else {
                        Instant::now() + AUTHORITY_LIFETIME
                    },
                },
            );
        Ok(format!("Bearer {token}"))
    }
}

fn bearer_token(authorization: Option<&str>) -> Result<&str, AuthorizationFailure> {
    let authorization =
        authorization.ok_or_else(|| failure("caller_run_unbound", "authorization_missing"))?;
    let (scheme, token) = authorization
        .split_once(' ')
        .ok_or_else(|| failure("caller_run_unbound", "authorization_malformed"))?;
    if !scheme.eq_ignore_ascii_case("bearer") || token.is_empty() || token.contains(' ') {
        return Err(failure("caller_run_unbound", "authorization_malformed"));
    }
    Ok(token)
}

fn digest(token: &str) -> [u8; 32] {
    Sha256::digest(token.as_bytes()).into()
}

fn failure(error: &str, reason: &str) -> AuthorizationFailure {
    AuthorizationFailure(json!({"ok": false, "error": error, "reason": reason}))
}

fn public_id(value: &str) -> String {
    let compact = value.replace('-', "");
    if compact.len() != 32 || !compact.bytes().all(|byte| byte.is_ascii_hexdigit()) {
        return value.to_owned();
    }
    format!(
        "{}-{}-{}-{}-{}",
        &compact[0..8],
        &compact[8..12],
        &compact[12..16],
        &compact[16..20],
        &compact[20..32]
    )
}

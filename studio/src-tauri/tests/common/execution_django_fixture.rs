//! Historical Django execution stores, for adoption and recovery fixtures.
//!
//! The cutover retired the Python execution capability but deliberately kept
//! its migration history, because that history is the contract Rust adoption
//! classifies. These fixtures install the app for the fixture process only and
//! run the real migrations, so every supported leaf is reproduced rather than
//! described by hand. Nothing here revives a Python execution runtime: the
//! deleted models, signals, routes, and schedulers stay deleted.
#![allow(dead_code)]

use std::path::{Path, PathBuf};
use std::process::Command;

/// The current execution leaf, and the only one a fresh install produces.
pub const CURRENT_LEAF: &str = "0007_graph_run_launch_configuration";

/// Every leaf Rust adoption names a bridge for, oldest first.
pub const LEAVES: &[&str] = &[
    "0001_initial",
    "0002_graphrun",
    "0003_nullable_agent_override",
    "0004_remove_enginerun_phase",
    "0005_launchedtask_delete_enginerun",
    "0006_graphrun_execution_mode",
    CURRENT_LEAF,
];

pub const PROJECT: &str = "00000000000000000000000000089301";
pub const MODULE: &str = "00000000000000000000000000089305";
/// The serial campaign root, and its one claimed direct child.
pub const SERIAL_ROOT: &str = "00000000000000000000000000089306";
pub const CLAIMED_CHILD: &str = "00000000000000000000000000089307";
/// The parallel campaign root that predates the policy snapshot.
pub const PARALLEL_ROOT: &str = "00000000000000000000000000089309";
pub const PARALLEL_CHILD: &str = "00000000000000000000000000089310";
pub const CLAIMED_AGENT_RUN: &str = "run-893";
/// The claim timestamp as stored, so assertions do not move with the
/// developer's configured Django time zone.
pub const CLAIMED_LAUNCHED_AT: &str = "2026-08-19 17:30:00";

pub fn repository_root() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../..")
        .canonicalize()
        .expect("resolve repository root")
}

/// Provision a store whose execution history ends at `leaf`. Every other app
/// migrates to its own leaf first, so adoption sees the surrounding Runs and
/// Work Management schema a real installation would have.
pub fn migrate_leaf(data_directory: &Path, leaf: &str) {
    run(
        &format!(
            "{PREAMBLE}
call_command('migrate', interactive=False, verbosity=0)
call_command('migrate', 'execution', {leaf:?}, interactive=False, verbosity=0)
"
        ),
        data_directory,
    );
}

/// Provision the current leaf carrying a serial campaign with a settled claim,
/// a parallel campaign that predates the policy snapshot, and one pending
/// launch-policy receipt.
pub fn provision_current(data_directory: &Path) {
    run(SEEDED_CURRENT_LEAF, data_directory);
}

/// Drift a provisioned store, so preflight is observed refusing it.
pub fn mutate(data_directory: &Path, sql: &str) {
    let output = Command::new(repository_root().join("backend/.venv/bin/python"))
        .args([
            "-c",
            "import sqlite3,sys; c=sqlite3.connect(sys.argv[1]); c.executescript(sys.argv[2]); c.commit()",
        ])
        .arg(data_directory.join("state.db"))
        .arg(sql)
        .output()
        .expect("run the execution fixture mutation");
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
}

fn run(script: &str, data_directory: &Path) {
    let output = Command::new(repository_root().join("backend/.venv/bin/python"))
        .args(["-c", script])
        .arg(data_directory.join("state.db"))
        .current_dir(repository_root())
        .output()
        .expect("run the historical execution migrations");
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
}

const PREAMBLE: &str = r#"
import os, sys
from pathlib import Path
db=Path(sys.argv[1]).resolve()
os.environ['DJANGO_SETTINGS_MODULE']='studio_server.settings'
os.environ['MUXED_STATE_DB']=str(db)
os.environ['MUXED_DATA_DIR']=str(db.parent)
os.environ['MUXED_FORCE_SQLITE']='true'
from studio_server import settings
# The shipping capability no longer installs the retired execution app. The
# fixture process installs its kept migration history so Rust adoption is
# exercised against the real historical schema.
settings.INSTALLED_APPS=[*settings.INSTALLED_APPS,'apps.execution']
import django; django.setup()
from django.core.management import call_command
from django.db import connection
"#;

/// Execution rows are inserted as stored values rather than through the retired
/// models, so the fixture neither needs the deleted Python code nor depends on
/// a locally configured time zone to decide what adoption must preserve.
const SEEDED_CURRENT_LEAF: &str = r#"
import os, sys, json
from pathlib import Path
db=Path(sys.argv[1]).resolve()
os.environ['DJANGO_SETTINGS_MODULE']='studio_server.settings'
os.environ['MUXED_STATE_DB']=str(db)
os.environ['MUXED_DATA_DIR']=str(db.parent)
os.environ['MUXED_FORCE_SQLITE']='true'
from studio_server import settings
settings.INSTALLED_APPS=[*settings.INSTALLED_APPS,'apps.execution']
import django; django.setup()
from django.core.management import call_command
from django.db import connection
from worktracker.models import Workspace, Project, State, IssueType, Issue
from apps.runs.models import AgentRun
call_command('migrate', interactive=False, verbosity=0)
w=Workspace.objects.create(id='00000000000000000000000000089300',slug='execution-adoption',name='Execution Adoption')
p=Project.objects.create(id='00000000000000000000000000089301',workspace=w,name='Execution Adoption',slug='T893',seq_counter=893)
s=State.objects.create(id='00000000000000000000000000089302',project=p,name='Todo',group='unstarted',sort_order=1)
mt=IssueType.objects.create(id='00000000000000000000000000089303',project=p,name='Module',level='module',sort_order=1,start_state=s)
tt=IssueType.objects.create(id='00000000000000000000000000089304',project=p,name='Implementation',level='task',sort_order=2,start_state=s)
m=Issue.objects.create(id='00000000000000000000000000089305',project=p,type='module',issue_type=mt,state=s,name='Module',sequence_id=891,rank='a')
r=Issue.objects.create(id='00000000000000000000000000089306',project=p,type='task',issue_type=tt,state=s,parent=m,module=m,name='Root',sequence_id=892,rank='b')
c=Issue.objects.create(id='00000000000000000000000000089307',project=p,type='task',issue_type=tt,state=s,parent=r,module=m,name='Child',sequence_id=893,rank='c')
r2=Issue.objects.create(id='00000000000000000000000000089309',project=p,type='task',issue_type=tt,state=s,parent=m,module=m,name='Parallel Root',sequence_id=894,rank='d')
Issue.objects.create(id='00000000000000000000000000089310',project=p,type='task',issue_type=tt,state=s,parent=r2,module=m,name='Parallel Child',sequence_id=895,rank='e')
AgentRun.objects.create(id='run-893',issue=c,agent='codex',status='completed',started_at='2026-08-19 12:30:00',ended_at='2026-08-19 12:45:00',scope='task')
snapshot=json.dumps({'prompt':'implement','agent':'codex','model':None,'reasoning':None,'required_skills':[],'policy_version':1})
with connection.cursor() as cursor:
    cursor.execute(
        'INSERT INTO graph_runs (root_id, project_id, module_id, agent, execution_mode, launch_configuration, created_at, updated_at)'
        ' VALUES (%s, %s, %s, %s, %s, %s, %s, %s)',
        [r.id, p.id, m.id, 'codex', 'serial', snapshot, '2026-08-19 17:00:00', '2026-08-19 18:00:00'],
    )
    cursor.execute(
        'INSERT INTO graph_runs (root_id, project_id, module_id, agent, execution_mode, launch_configuration, created_at, updated_at)'
        ' VALUES (%s, %s, %s, %s, %s, %s, %s, %s)',
        [r2.id, p.id, m.id, None, 'parallel', None, '2026-08-19 17:00:00', '2026-08-19 17:00:00'],
    )
    cursor.execute(
        'INSERT INTO launched_tasks (task_id, root_id, agent_run_id, launched_at) VALUES (%s, %s, %s, %s)',
        [c.id, r.id, 'run-893', '2026-08-19 17:30:00'],
    )
    cursor.execute(
        'INSERT INTO launch_policy_effects (decision_id, caller_scope, idempotency_key, result, created_at, updated_at)'
        ' VALUES (%s, %s, %s, %s, %s, %s)',
        ['00000000000000000000000000089308', 'graph', 'root-893', None, '2026-08-19 17:00:00', '2026-08-19 17:00:00'],
    )
"#;

/// Provision the current leaf carrying a realistic campaign installation and no
/// execution rows at all: two candidate roots, an outside blocker, an archived
/// branch, a grandchild, a childless root, and a second project the caller is
/// not authorized for. Adoption therefore starts from an installation that has
/// never armed a campaign, which is what a real upgrade looks like.
pub fn provision_campaign_installation(data_directory: &Path) {
    run(CAMPAIGN_INSTALLATION, data_directory);
}

pub const CAMPAIGN_PROJECT: &str = "00000000-0000-0000-0000-000000090301";
pub const CAMPAIGN_MODULE: &str = "00000000-0000-0000-0000-000000090305";
pub const TODO_STATE: &str = "00000000-0000-0000-0000-000000090310";
pub const IMPLEMENT_STATE: &str = "00000000-0000-0000-0000-000000090311";
pub const REVIEW_STATE: &str = "00000000-0000-0000-0000-000000090312";
pub const DONE_STATE: &str = "00000000-0000-0000-0000-000000090313";
pub const TASK_TYPE: &str = "00000000-0000-0000-0000-000000090321";

pub const PARALLEL_CAMPAIGN_ROOT: &str = "00000000-0000-0000-0000-000000090330";
pub const READY_FIRST: &str = "00000000-0000-0000-0000-000000090331";
pub const READY_SECOND: &str = "00000000-0000-0000-0000-000000090332";
pub const EXTERNALLY_BLOCKED: &str = "00000000-0000-0000-0000-000000090333";
pub const ARCHIVED_CHILD: &str = "00000000-0000-0000-0000-000000090334";
pub const GRANDCHILD: &str = "00000000-0000-0000-0000-000000090335";

pub const SERIAL_CAMPAIGN_ROOT: &str = "00000000-0000-0000-0000-000000090340";
pub const SERIAL_FIRST: &str = "00000000-0000-0000-0000-000000090341";
pub const SERIAL_SECOND: &str = "00000000-0000-0000-0000-000000090342";
pub const SERIAL_THIRD: &str = "00000000-0000-0000-0000-000000090343";

/// A blocker outside every campaign subtree, so external dependencies are
/// observed gating and releasing children.
pub const OUTSIDE_BLOCKER: &str = "00000000-0000-0000-0000-000000090350";
/// A task-level root with no children, so an empty graph is refused.
pub const CHILDLESS_ROOT: &str = "00000000-0000-0000-0000-000000090360";

pub const FOREIGN_PROJECT: &str = "00000000-0000-0000-0000-000000090401";
pub const FOREIGN_ROOT: &str = "00000000-0000-0000-0000-000000090430";
pub const FOREIGN_CHILD: &str = "00000000-0000-0000-0000-000000090431";

pub const PROVIDER_SLUG: &str = "codex";
pub const MODEL_NAME: &str = "slice6-model";

const CAMPAIGN_INSTALLATION: &str = r#"
import os, sys
from pathlib import Path
db=Path(sys.argv[1]).resolve()
os.environ['DJANGO_SETTINGS_MODULE']='studio_server.settings'
os.environ['MUXED_STATE_DB']=str(db)
os.environ['MUXED_DATA_DIR']=str(db.parent)
os.environ['MUXED_FORCE_SQLITE']='true'
from studio_server import settings
settings.INSTALLED_APPS=[*settings.INSTALLED_APPS,'apps.execution']
import django; django.setup()
from django.core.management import call_command
from worktracker.models import (
    AgentModel, Issue, IssueType, LaunchBinding, Project, Provider, State, Workspace,
)
call_command('migrate', interactive=False, verbosity=0)

def issue(identifier, kind, name, sequence, rank, *, parent=None, module=None,
          state=None, archived=False, project=None, issue_type=None):
    return Issue.objects.create(
        id=identifier, project=project, type=kind, issue_type=issue_type,
        parent=parent, module=module, state=state, name=name,
        sequence_id=sequence, rank=rank, is_archived=archived,
    )

workspace=Workspace.objects.create(id='00000000000000000000000000090300',slug='slice6-execution',name='Slice 6 Execution')
project=Project.objects.create(id='00000000000000000000000000090301',workspace=workspace,name='Slice 6 Execution',slug='EXEC',seq_counter=900)
todo=State.objects.create(id='00000000000000000000000000090310',project=project,name='Todo',group='unstarted',sort_order=1)
implement=State.objects.create(id='00000000000000000000000000090311',project=project,name='Implement',group='started',sort_order=2)
review=State.objects.create(id='00000000000000000000000000090312',project=project,name='Review',group='started',sort_order=3)
done=State.objects.create(id='00000000000000000000000000090313',project=project,name='Done',group='completed',sort_order=4)
module_type=IssueType.objects.create(id='00000000000000000000000000090320',project=project,name='Module',level='module',sort_order=1,start_state=todo)
task_type=IssueType.objects.create(id='00000000000000000000000000090321',project=project,name='Implementation',level='task',sort_order=2,start_state=todo)
# The catalogue seed already ships the supported providers, so activation is
# an update rather than a second row.
provider=Provider.objects.get(slug='codex')
Provider.objects.filter(pk=provider.pk).update(activated=True,supports_unattended=True)
provider.refresh_from_db()
model,_=AgentModel.objects.get_or_create(provider=provider,name='slice6-model',defaults={'id':'00000000000000000000000000090371'})
# Subtree execution is enabled from Todo; entering Implement is the auto-start
# transition, so one committed move produces at most one launch.
LaunchBinding.objects.create(issue_type=task_type,state=todo,prompt='Implement the slice.',required_skills=[],model=model,auto_start=False,subtree_run_enabled=True)
LaunchBinding.objects.create(issue_type=task_type,state=implement,prompt='Implement the slice.',required_skills=[],model=model,auto_start=True,subtree_run_enabled=True)

module=issue('00000000000000000000000000090305','module','Slice 6 module',900,'a',project=project,issue_type=module_type,state=todo)
task=dict(project=project,issue_type=task_type,module=module,state=todo)
parallel=issue('00000000000000000000000000090330','task','Parallel root',901,'b',parent=module,**task)
ready_first=issue('00000000000000000000000000090331','task','Ready first',902,'a',parent=parallel,**task)
ready_second=issue('00000000000000000000000000090332','task','Ready second',903,'b',parent=parallel,**task)
blocked=issue('00000000000000000000000000090333','task','Externally blocked',904,'c',parent=parallel,**task)
issue('00000000000000000000000000090334','task','Archived branch',905,'d',parent=parallel,archived=True,**task)
issue('00000000000000000000000000090335','task','Grandchild',906,'a',parent=ready_first,**task)
serial=issue('00000000000000000000000000090340','task','Serial root',910,'c',parent=module,**task)
issue('00000000000000000000000000090341','task','Serial first',911,'a',parent=serial,**task)
issue('00000000000000000000000000090342','task','Serial second',912,'b',parent=serial,**task)
issue('00000000000000000000000000090343','task','Serial third',913,'c',parent=serial,**task)
outside=issue('00000000000000000000000000090350','task','Outside blocker',920,'d',parent=module,**task)
issue('00000000000000000000000000090360','task','Childless root',930,'e',parent=module,**task)
blocked.blocked_by.add(outside)
# The root's own blocker must not gate its children.
parallel.blocked_by.add(outside)

foreign_workspace=Workspace.objects.create(id='00000000000000000000000000090400',slug='slice6-foreign',name='Slice 6 Foreign')
foreign_project=Project.objects.create(id='00000000000000000000000000090401',workspace=foreign_workspace,name='Slice 6 Foreign',slug='FRGN',seq_counter=940)
foreign_todo=State.objects.create(id='00000000000000000000000000090410',project=foreign_project,name='Todo',group='unstarted',sort_order=1)
foreign_module_type=IssueType.objects.create(id='00000000000000000000000000090420',project=foreign_project,name='Module',level='module',sort_order=1,start_state=foreign_todo)
foreign_task_type=IssueType.objects.create(id='00000000000000000000000000090421',project=foreign_project,name='Implementation',level='task',sort_order=2,start_state=foreign_todo)
LaunchBinding.objects.create(issue_type=foreign_task_type,state=foreign_todo,prompt='Implement the slice.',required_skills=[],model=model,auto_start=False,subtree_run_enabled=True)
foreign_module=issue('00000000000000000000000000090405','module','Foreign module',940,'a',project=foreign_project,issue_type=foreign_module_type,state=foreign_todo)
foreign_task=dict(project=foreign_project,issue_type=foreign_task_type,module=foreign_module,state=foreign_todo)
foreign_root=issue('00000000000000000000000000090430','task','Foreign root',941,'b',parent=foreign_module,**foreign_task)
issue('00000000000000000000000000090431','task','Foreign child',942,'a',parent=foreign_root,**foreign_task)
"#;

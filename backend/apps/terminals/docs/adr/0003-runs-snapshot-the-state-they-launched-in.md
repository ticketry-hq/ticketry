# Runs snapshot the state they launched in

A terminal tab names the workflow state its run was launched in — `Grill`,
`Spec`, `Implement` — so a person scanning a task workspace can tell which
conversation belongs to which phase of the work. That fact is only true at one
instant: the moment the run spawns. The work item moves on afterwards, and a
run started in Grill must keep saying Grill.

`AgentRun` therefore gains two nullable columns written once at spawn and never
updated: the launch state's name, and the model `resolve_task_launch_configuration`
actually resolved. Both are snapshots of a decision, not caches of a row that
still exists.

## Considered Options

Reading `issue.state` at render time is the obvious alternative and needs no
migration at all. It is also wrong for the feature: every tab in a workspace
would show the same word, and all of them would change together the moment the
ticket transitioned. That is precisely the information the tab is meant to
distinguish, so the cheap option does not implement the requirement.

Deriving the launch state from `AutomationAttempt.to_state_id` was the second
candidate, and it is genuinely correct where it applies — the attempt already
records the state whose transition triggered the launch. It only applies to
automated launches. A run started from the tab strip's `＋ Agent` menu has no
attempt row, and manual launches are the common case, so this would have left
the majority of tabs blank.

Storing a foreign key to the state row rather than its name was considered and
rejected. The tab renders a word; a key would make the label depend on a row
that can be renamed or deleted underneath it, reintroducing the mutability the
snapshot exists to escape.

Resolving the model at render time is not possible even in principle — the
launch configuration is computed from a binding that can be edited afterwards,
so the only place the truth exists is the launch itself. It rides along in this
migration because a second migration later costs more than a second nullable
column now.

## Consequences

Two columns now duplicate information that also lives elsewhere, and a reader
who notices `agent_runs.launch_state` sitting a join away from `issues.state_id`
will reasonably wonder why. The answer is that they are different facts that
happen to coincide at spawn: one is where the work item is, the other is where
it was when this conversation started.

Every run that predates the migration has both columns null. These are not
backfillable — the state they launched in is unrecoverable, and inferring it
from the ticket's current state would produce a confident lie. Such runs render
with their provider colour and no state word, and readers must treat null as
"not recorded" rather than substituting a default.

Renaming a workflow state does not rewrite history. Tabs launched before the
rename keep the old word, which is correct — that *is* what the state was
called at the time — but it means the strip can show a word that no longer
appears in the workflow editor.

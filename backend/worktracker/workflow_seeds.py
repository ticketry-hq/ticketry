"""Workflow seeds derived from ``worktracker/reviewed_defaults.json``.

Runtime transition code must not import this module. These name-based templates
adapt the reviewed artifact into the historical shape consumed by migration
replay and fresh-project creation. The artifact is read once at import time;
after project-owned rows are materialized, runtime workflow behavior reads only
those rows.
"""

from worktracker.reviewed_defaults import REVIEWED_DEFAULTS


def _workflow_template(workflow):
    transitions = {state_name: [] for state_name in workflow["states"]}
    agent_allowed = {}
    for edge in workflow["transitions"]:
        source, target = edge[:2]
        metadata = edge[2] if len(edge) == 3 else {}
        transitions[source].append(target)
        agent_allowed[(source, target)] = metadata.get("agentAllowed", True)
    return {
        "start": workflow["start"],
        "transitions": {
            source: tuple(targets) for source, targets in transitions.items()
        },
        "agent_allowed": agent_allowed,
    }


DEFAULT_WORKFLOW_TEMPLATES = {
    issue_type: _workflow_template(REVIEWED_DEFAULTS["workflows"][issue_type])
    for issue_type in REVIEWED_DEFAULTS["issueTypes"]
}

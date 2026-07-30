"""Boot-time projections of the reviewed workflow defaults artifact."""

import json
from importlib.resources import files


REVIEWED_DEFAULTS = json.loads(
    files("worktracker").joinpath("reviewed_defaults.json").read_text(encoding="utf-8")
)

REVIEWED_STATES = tuple(
    (state["name"], state["group"], state["color"])
    for state in REVIEWED_DEFAULTS["states"]
)
REVIEWED_TASK_ISSUE_TYPES = tuple(REVIEWED_DEFAULTS["issueTypes"])
REVIEWED_REQUIRED_SKILLS = {
    state_name: tuple(required_skills)
    for state_name, required_skills in REVIEWED_DEFAULTS["requiredSkills"].items()
}

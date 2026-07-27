"""Router-free workflow-state projections shared by signals and status APIs."""


def workflow_state_projection(state) -> dict:
    return {
        "id": str(state.pk),
        "name": state.name,
        "group": state.group,
        "color": state.color,
        "sort_order": state.sort_order,
        "is_protected": state.is_protected,
    }

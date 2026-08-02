"""Contract checks for the generated-SDK-only server boundary."""

import ast
from pathlib import Path

from worktracker_sdk.generated import ApiClient, Configuration, ProjectsApi


SERVER_ROOT = Path(__file__).parents[2]
HAND_ROLLED_MODULES = {
    "worktracker_sdk.client",
    "worktracker_sdk.errors",
    "worktracker_sdk.models",
    "worktracker_sdk.resources",
}
HAND_ROLLED_ROOT_MODULES = {module.rsplit(".", 1)[1] for module in HAND_ROLLED_MODULES}
HAND_ROLLED_ROOT_EXPORTS = {
    "ApiError",
    "Attachment",
    "AuthenticationError",
    "DependencyGraph",
    "DependencyGraphRead",
    "DependencyGraphReadNode",
    "GraphNode",
    "IssueLevel",
    "IssueType",
    "LaunchedAgent",
    "LeafLldResult",
    "LeafLldRun",
    "Module",
    "ModuleCreate",
    "ModuleWorkItemCreate",
    "NotFoundError",
    "PlanningRun",
    "Project",
    "ProjectCreate",
    "ProjectUpdate",
    "ReleasePlanningRunResult",
    "ReparentedItem",
    "ReparentFailure",
    "ReparentResult",
    "ReparentSkip",
    "ResponseValidationError",
    "ReviewFindingCreate",
    "ScopeContext",
    "ScopeRef",
    "State",
    "StateGroup",
    "TaskManagerClient",
    "TaskManagerError",
    "TaskManagerValidationError",
    "TransportError",
    "WorkItem",
    "WorkItemCreate",
    "WorkItemDetail",
    "WorkItemUpdate",
}


def _is_hand_rolled_module(module_name: str) -> bool:
    return any(
        module_name == module or module_name.startswith(f"{module}.")
        for module in HAND_ROLLED_MODULES
    )


def test_server_has_no_hand_rolled_sdk_imports():
    offenders = []

    paths = (
        path
        for path in SERVER_ROOT.rglob("*.py")
        if not any(
            part.startswith(".") for part in path.relative_to(SERVER_ROOT).parts
        )
    )
    for path in paths:
        tree = ast.parse(path.read_text(), filename=str(path))
        root_aliases = {
            alias.asname or alias.name
            for node in ast.walk(tree)
            if isinstance(node, ast.Import)
            for alias in node.names
            if alias.name == "worktracker_sdk"
        }
        for node in ast.walk(tree):
            if isinstance(node, ast.Import):
                imports = {alias.name for alias in node.names}
                forbidden = {
                    imported
                    for imported in imports
                    if _is_hand_rolled_module(imported)
                }
            elif isinstance(node, ast.ImportFrom):
                imported_names = {alias.name for alias in node.names}
                if node.module and _is_hand_rolled_module(node.module):
                    forbidden = {node.module}
                elif node.module == "worktracker_sdk":
                    forbidden = imported_names.intersection(
                        HAND_ROLLED_ROOT_EXPORTS
                        | HAND_ROLLED_ROOT_MODULES
                        | {"*"}
                    )
                else:
                    forbidden = set()
            elif (
                isinstance(node, ast.Attribute)
                and isinstance(node.value, ast.Name)
                and node.value.id in root_aliases
                and node.attr
                in HAND_ROLLED_ROOT_EXPORTS | HAND_ROLLED_ROOT_MODULES
            ):
                forbidden = {node.attr}
            else:
                continue

            for name in forbidden:
                offenders.append((str(path.relative_to(SERVER_ROOT)), name))

    assert offenders == []


def test_generated_sdk_is_importable_in_the_server_test_environment():
    configuration = Configuration(host="https://worktracker.test/api/work-tracker")
    client = ApiClient(configuration)

    assert isinstance(ProjectsApi(client), ProjectsApi)

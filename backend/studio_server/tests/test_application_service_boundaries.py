"""Architecture guards for the DRF-to-application service boundary."""

import ast
import inspect
from pathlib import Path

from worktracker.rest.views import (
    IssueTypeTransitionListView,
    IssueTypeViewSet,
    LaunchBindingDetailView,
)


BACKEND_ROOT = Path(__file__).parents[2]
APPLICATION_OPERATION_MODULES = (
    "apps/documents/api.py",
    "apps/runs/api.py",
    "apps/settings_store/api.py",
    "apps/worktrees/api.py",
)


def test_application_operations_do_not_depend_on_http_transport():
    offenders = []
    for relative_path in APPLICATION_OPERATION_MODULES:
        path = BACKEND_ROOT / relative_path
        tree = ast.parse(path.read_text(), filename=str(path))
        for node in ast.walk(tree):
            if isinstance(node, ast.ImportFrom) and node.module == "django.http":
                offenders.append((relative_path, node.lineno, "django.http"))
            if isinstance(node, ast.Import) and any(
                alias.name == "django.http" for alias in node.names
            ):
                offenders.append((relative_path, node.lineno, "django.http"))
            if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
                argument_names = {
                    argument.arg
                    for argument in (
                        *node.args.posonlyargs,
                        *node.args.args,
                        *node.args.kwonlyargs,
                    )
                }
                if "request" in argument_names:
                    offenders.append((relative_path, node.lineno, node.name))

    assert offenders == []


def test_host_drf_adapter_does_not_reinterpret_nested_http_responses():
    source = (BACKEND_ROOT / "apps/rest_api.py").read_text()

    assert "HttpResponseBase" not in source
    assert "JsonResponse" not in source


def test_launch_binding_view_delegates_transaction_work_to_service():
    source = inspect.getsource(LaunchBindingDetailView)

    assert "select_for_update" not in source
    assert "LaunchBinding.objects" not in source
    assert "launch_bindings.upsert_launch_binding" in source
    assert "launch_bindings.delete_launch_binding" in source


def test_bespoke_work_item_views_do_not_query_or_coordinate_persistence():
    work_items_source = (BACKEND_ROOT / "worktracker/rest/work_items.py").read_text()
    domain_ops_source = (BACKEND_ROOT / "worktracker/rest/domain_ops.py").read_text()

    assert ".objects" not in work_items_source
    assert "from worktracker.models" not in work_items_source
    assert "resolve_issue" not in domain_ops_source


def test_workflow_views_make_one_coordination_service_call():
    issue_type_update = inspect.getsource(IssueTypeViewSet.perform_update)
    issue_type_delete = inspect.getsource(IssueTypeViewSet.destroy)
    transition_collection = inspect.getsource(IssueTypeTransitionListView)

    assert "transaction.atomic" not in issue_type_update
    assert "update_issue_type_configuration" in issue_type_update
    assert "set_start_state" not in issue_type_update
    assert "get_object" not in issue_type_delete
    assert "delete_issue_type" in issue_type_delete
    assert "IssueTypeTransition.objects" not in transition_collection
    assert "scoped_workflows.list_transitions" in transition_collection

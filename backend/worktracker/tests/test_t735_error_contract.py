"""#735: the framework-neutral service error contract.

Pins the contract in ``worktracker.services.errors`` and its single route-layer
translation seam:

- The service layer raises only ``ServiceError`` subclasses carrying a
  HTTP-mappable ``status_code`` + ``message`` (404 / 422 / 409).
- ``ConflictError`` is the named peer of ``NotFoundError`` / ``ValidationError``
  for 409, replacing raw ``ServiceError(409, ...)`` at the conflict sites.
- No module under ``services/`` imports Ninja.
- The route layer maps each code unchanged (one 409 mapping pinned here; 404 /
  422 stay covered by ``test_t734_error_mapping``).
"""

import ast
import pathlib
import uuid

import pytest

from worktracker.models import IssueType, Project
from worktracker.services.errors import (
    ConflictError,
    NotFoundError,
    ServiceError,
    ValidationError,
)
from worktracker.services.projects import create_project as create_project_service
from worktracker.tests.conftest import BASE, post_json
from worktracker.work_items import resolve_issue_type


# --- the contract types ----------------------------------------------------


def test_status_codes_are_frozen():
    assert NotFoundError("x").status_code == 404
    assert ValidationError("x").status_code == 422
    assert ConflictError("x").status_code == 409


def test_conflict_error_is_a_service_error_carrying_message():
    err = ConflictError("already exists")
    assert isinstance(err, ServiceError)
    assert err.status_code == 409
    assert err.message == "already exists"
    assert err.status == 409  # the alias property


# --- the shared resolve_issue_type helper raises domain errors -------------


@pytest.mark.django_db
def test_resolve_issue_type_missing_raises_not_found(project):
    with pytest.raises(NotFoundError) as exc:
        resolve_issue_type(project.id, uuid.uuid4(), "task")
    assert exc.value.status_code == 404


@pytest.mark.django_db
def test_resolve_issue_type_wrong_level_raises_validation(project):
    module_type = IssueType.objects.create(
        id=uuid.uuid4(), project=project, name="EpicType", level="module"
    )
    with pytest.raises(ValidationError) as exc:
        resolve_issue_type(project.id, module_type.id, "task")
    assert exc.value.status_code == 422


# --- migrated conflict sites now raise the named ConflictError -------------


@pytest.mark.django_db
def test_duplicate_project_slug_raises_conflict(project):
    with pytest.raises(ConflictError) as exc:
        create_project_service(name="dup", slug=project.slug)
    assert exc.value.status_code == 409
    assert exc.value.message == f"Project slug '{project.slug}' already exists."


# --- framework-neutrality regression fence ---------------------------------


#: Modules whose import would let a service signal a failure in a way
#: ``api/router.py:_http_errors()`` never sees. ``ninja`` is the obvious one;
#: ``django.shortcuts`` (``get_object_or_404``) and ``django.http``
#: (``Http404``) are the quiet ones — they are not Ninja, so a narrower fence
#: misses them, but they raise a framework exception that bypasses the
#: ``ServiceError`` contract and reaches non-HTTP callers (the MCP surface) as
#: a Django HTTP error.
_FRAMEWORK_ERROR_MODULES = ("ninja", "django.shortcuts", "django.http")

#: ``queries.py`` imports ``Http404`` on purpose, to *convert* what
#: ``worktracker/work_items.py`` still raises into ``NotFoundError``. That
#: module sits outside ``services/`` and is a separate follow-up; until it is
#: converted, the catch is the thing keeping the contract true.
_CONVERSION_EXEMPT = {"queries.py"}


def test_services_raise_only_framework_neutral_errors():
    """No service module may import a framework's own error mechanism.

    Services raise ``ServiceError`` subclasses carrying an HTTP-mappable
    ``status_code`` and ``message``; ``api/router.py:_http_errors()`` is the
    single translation seam.
    """

    services_dir = pathlib.Path(__file__).resolve().parent.parent / "services"
    offenders = []
    for path in services_dir.glob("*.py"):
        if path.name in _CONVERSION_EXEMPT:
            continue
        tree = ast.parse(path.read_text())
        for node in ast.walk(tree):
            if isinstance(node, ast.Import):
                names = [a.name for a in node.names]
            elif isinstance(node, ast.ImportFrom):
                names = [node.module or ""]
            else:
                continue
            if any(
                name == forbidden or name.startswith(f"{forbidden}.")
                for name in names
                for forbidden in _FRAMEWORK_ERROR_MODULES
            ):
                offenders.append(path.name)
    assert offenders == [], (
        "service modules must raise ServiceError, not framework errors: "
        f"{offenders}"
    )


# --- route boundary pins the 409 mapping -----------------------------------


@pytest.mark.django_db
def test_duplicate_project_slug_maps_to_http_409(client, project, auth):
    """ConflictError surfaces as HTTP 409 with its message at the boundary."""
    Project.objects.create(
        id=uuid.uuid4(),
        name="Existing",
        slug="DUP",
    )
    r = post_json(client, f"{BASE}/projects", {"name": "dup", "slug": "DUP"}, auth)
    assert r.status_code == 409
    assert r.json()["detail"] == "Project slug 'DUP' already exists."

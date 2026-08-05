"""Three-tier conformance against the complete live Django route table."""

import re

import pytest
from django.urls import URLResolver, get_resolver

from worktracker.registry import (
    DOMAIN_OPERATIONS,
    FRAMEWORK_ROUTE_EXCLUSIONS,
    declared_model_route_keys,
    ninja_route_allowlist,
)


HTTP_METHODS = {"get", "post", "put", "patch", "delete"}


def _normalize_path(path):
    path = re.sub(r"<(?:[^>:]+:)?([^>]+)>", r"{\1}", path)
    return "/" + path.strip("/")


def _walk(patterns, prefix=""):
    for pattern in patterns:
        path = prefix + str(pattern.pattern)
        if isinstance(pattern, URLResolver):
            yield from _walk(pattern.url_patterns, path)
        else:
            yield _normalize_path(path), pattern


def _ninja_methods(pattern):
    callback = pattern.callback
    if getattr(callback, "__module__", "") != "ninja.operation":
        return set()
    path_view = next(
        (
            cell.cell_contents
            for cell in callback.__closure__ or ()
            if hasattr(cell.cell_contents, "operations")
        ),
        None,
    )
    if path_view is None:
        return set()
    operation = next(
        (
            candidate
            for candidate in path_view.operations
            if candidate.view_func.__name__ == pattern.name
        ),
        None,
    )
    return set(operation.methods) if operation else set()


def _drf_methods(pattern):
    view_class = getattr(pattern.callback, "cls", None)
    if view_class is None:
        return set()
    actions = getattr(pattern.callback, "actions", None)
    if actions:
        return {method.upper() for method in actions if method in HTTP_METHODS}
    return {
        method.upper()
        for method in HTTP_METHODS
        if method in view_class.http_method_names and hasattr(view_class, method)
    }


def _is_excluded(path):
    return any(
        path == exclusion.rstrip("/")
        or (exclusion.endswith("/") and path.startswith(exclusion))
        for exclusion in FRAMEWORK_ROUTE_EXCLUSIONS
    )


def _live_tiers():
    declared_model_routes = declared_model_route_keys()
    model_routes = set()
    ninja_routes = set()
    unaccounted = set()
    for path, pattern in _walk(get_resolver().url_patterns):
        if _is_excluded(path):
            continue
        drf_methods = _drf_methods(pattern)
        ninja_methods = _ninja_methods(pattern)
        if drf_methods:
            model_routes.update((method, path) for method in drf_methods)
        elif ninja_methods:
            route_keys = {(method, path) for method in ninja_methods}
            model_routes.update(route_keys & declared_model_routes)
            ninja_routes.update(route_keys - declared_model_routes)
        else:
            unaccounted.add(path)
    return model_routes, ninja_routes, unaccounted


def _assert_exact(tier, live, declared):
    assert live == declared, (
        f"{tier} route registry mismatch; "
        f"undeclared={sorted(live - declared)!r}, "
        f"missing={sorted(declared - live)!r}"
    )


def test_full_live_route_table_matches_all_three_declaration_tiers():
    model_routes, ninja_routes, unaccounted = _live_tiers()

    _assert_exact("per-model", model_routes, declared_model_route_keys())
    _assert_exact("Ninja allowlist", ninja_routes, ninja_route_allowlist())
    assert unaccounted == set(), f"routes outside all registry tiers: {unaccounted!r}"


def test_quarantine_contains_exactly_five_reasoned_operations():
    assert len(DOMAIN_OPERATIONS) == 5
    assert all(operation.purpose.strip() for operation in DOMAIN_OPERATIONS)


def test_tier_two_contains_only_routes_outside_the_worktracker_mount():
    assert all(
        not path.startswith("/api/work-tracker/")
        for _, path in ninja_route_allowlist()
    )


@pytest.mark.parametrize("method,path", sorted(declared_model_route_keys()))
def test_every_declared_worktracker_route_requires_the_api_key(client, method, path):
    concrete_path = re.sub(r"\{[^}]+\}", "00000000-0000-0000-0000-000000000000", path)
    assert client.generic(method, concrete_path).status_code == 401


def test_conformance_comparison_rejects_an_undeclared_live_route():
    declared = declared_model_route_keys()
    with pytest.raises(AssertionError, match="undeclared"):
        _assert_exact(
            "per-model", declared | {("GET", "/api/work-tracker/surprise")}, declared
        )


def test_conformance_comparison_rejects_a_declared_route_that_is_missing():
    declared = declared_model_route_keys()
    with pytest.raises(AssertionError, match="missing"):
        _assert_exact("per-model", set(), declared)


def test_deleted_scope_context_route_does_not_resolve(client):
    response = client.get(
        "/api/work-tracker/work-items/"
        "00000000-0000-0000-0000-000000000000/scope-context"
    )

    assert response.status_code == 404

"""Two-way conformance against the complete live Django route table."""

import re

import pytest
from django.urls import URLResolver, get_resolver

from worktracker.registry import (
    DOMAIN_OPERATIONS,
    FRAMEWORK_ROUTE_EXCLUSIONS,
    HOST_ROUTES,
    PUBLIC_ROUTE_REASONS,
    declared_api_key_route_keys,
    declared_public_route_keys,
    declared_route_keys,
)

HTTP_METHODS = {"get", "post", "put", "patch", "delete"}


def _normalize_path(path):
    path = re.sub(r"<(?:[^>:]+:)?([^>]+)>", r"{\1}", path)
    return "/" + path.lstrip("/")


def _walk(patterns, prefix=""):
    for pattern in patterns:
        path = prefix + str(pattern.pattern)
        if isinstance(pattern, URLResolver):
            yield from _walk(pattern.url_patterns, path)
        else:
            yield _normalize_path(path), pattern


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


def _live_routes():
    live_routes = set()
    unaccounted = set()
    for path, pattern in _walk(get_resolver().url_patterns):
        if _is_excluded(path):
            continue
        drf_methods = _drf_methods(pattern)
        if drf_methods:
            live_routes.update((method, path) for method in drf_methods)
        else:
            unaccounted.add(path)
    return live_routes, unaccounted


def _assert_exact(tier, live, declared):
    assert live == declared, (
        f"{tier} route registry mismatch; "
        f"undeclared={sorted(live - declared)!r}, "
        f"missing={sorted(declared - live)!r}"
    )


def test_full_live_route_table_matches_the_complete_declaration():
    live_routes, unaccounted = _live_routes()

    _assert_exact("HTTP", live_routes, declared_route_keys())
    assert unaccounted == set(), f"routes outside all registry tiers: {unaccounted!r}"


def test_quarantine_contains_exactly_seven_reasoned_operations():
    assert len(DOMAIN_OPERATIONS) == 7
    assert all(operation.purpose.strip() for operation in DOMAIN_OPERATIONS)


def test_host_routes_contain_only_routes_outside_the_worktracker_mount():
    assert all(
        not path.startswith("/api/work-tracker/")
        for _, path in (route.key for route in HOST_ROUTES)
    )


@pytest.mark.parametrize("method,path", sorted(declared_api_key_route_keys()))
def test_every_declared_api_key_route_requires_the_api_key(client, method, path):
    concrete_path = path.replace("{index}", "0")
    concrete_path = re.sub(
        r"\{[^}]+\}", "00000000-0000-0000-0000-000000000000", concrete_path
    )
    assert client.generic(method, concrete_path).status_code == 401


def test_public_routes_are_an_exact_reasoned_subset_of_the_registry():
    assert declared_public_route_keys() <= declared_route_keys()
    assert all(reason.strip() for reason in PUBLIC_ROUTE_REASONS.values())


def test_path_normalization_does_not_collapse_a_trailing_slash_route():
    assert _normalize_path("api/terminals") != _normalize_path("api/terminals/")


def test_conformance_comparison_rejects_an_undeclared_live_route():
    declared = declared_route_keys()
    with pytest.raises(AssertionError, match="undeclared"):
        _assert_exact(
            "per-model", declared | {("GET", "/api/work-tracker/surprise")}, declared
        )


def test_conformance_comparison_rejects_a_declared_route_that_is_missing():
    declared = declared_route_keys()
    with pytest.raises(AssertionError, match="missing"):
        _assert_exact("per-model", set(), declared)


def test_deleted_scope_context_route_does_not_resolve(client):
    response = client.get(
        "/api/work-tracker/work-items/"
        "00000000-0000-0000-0000-000000000000/scope-context"
    )

    assert response.status_code == 404

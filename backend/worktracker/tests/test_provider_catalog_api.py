import json

import pytest

from worktracker.models import AgentModel, LaunchBinding, Provider, ReasoningLevel
from worktracker.services.launch_bindings import (
    LaunchBindingError,
    validate_provider_options,
)
from worktracker.services.provider_catalog import (
    ProviderCatalogDrift,
    assert_provider_catalog_matches_adapters,
    provider_supports_unattended,
)


pytestmark = pytest.mark.django_db


def _post(client, path, body, auth):
    return client.post(
        path,
        data=json.dumps(body),
        content_type="application/json",
        headers=auth,
    )


def _patch(client, path, body, auth):
    return client.patch(
        path,
        data=json.dumps(body),
        content_type="application/json",
        headers=auth,
    )


def test_user_can_add_a_model_and_read_it_from_the_canonical_collection(client, auth):
    provider = Provider.objects.get(slug="codex")

    created = _post(
        client,
        "/api/work-tracker/models",
        {"provider": str(provider.id), "name": "gpt-next"},
        auth,
    )

    assert created.status_code == 201
    model_id = created.json()["id"]
    response = client.get("/api/work-tracker/models", headers=auth)
    assert response.status_code == 200
    assert {
        "id": model_id,
        "provider": str(provider.id),
        "name": "gpt-next",
        "permitted_reasoning_levels": [],
    } in response.json()


def test_catalog_reads_expose_the_exact_codex_5_6_reasoning_relationships(client, auth):
    provider = Provider.objects.get(slug="codex")
    levels_response = client.get("/api/work-tracker/reasoning-levels", headers=auth)
    models_response = client.get("/api/work-tracker/models", headers=auth)

    assert levels_response.status_code == 200
    assert models_response.status_code == 200
    level_names = {row["id"]: row["name"] for row in levels_response.json()}
    matrix = {
        row["name"]: {
            level_names[level_id] for level_id in row["permitted_reasoning_levels"]
        }
        for row in models_response.json()
        if row["provider"] == str(provider.id) and row["name"].startswith("gpt-5.6-")
    }
    assert matrix == {
        "gpt-5.6-sol": {"low", "medium", "high", "xhigh", "max", "ultra"},
        "gpt-5.6-terra": {"low", "medium", "high", "xhigh", "max", "ultra"},
        "gpt-5.6-luna": {"low", "medium", "high", "xhigh", "max"},
    }


def test_provider_activation_patch_changes_the_launch_gate(client, auth):
    provider = Provider.objects.get(slug="claude")

    deactivated = _patch(
        client,
        f"/api/work-tracker/providers/{provider.id}",
        {"activated": False},
        auth,
    )
    assert deactivated.status_code == 200
    with pytest.raises(LaunchBindingError) as raised:
        validate_provider_options(agent="claude", model=None, reasoning=None)
    assert raised.value.code == "provider_not_activated"

    activated = _patch(
        client,
        f"/api/work-tracker/providers/{provider.id}",
        {"activated": True},
        auth,
    )
    assert activated.status_code == 200
    assert validate_provider_options(agent="claude", model=None, reasoning=None) == (
        "claude",
        None,
        None,
    )


def test_deleting_unused_catalog_rows_cascades_only_the_owned_permitted_link(
    client, auth
):
    provider = Provider.objects.get(slug="codex")
    level = ReasoningLevel.objects.create(name="unused-level")
    model = AgentModel.objects.create(provider=provider, name="unused-model")
    model.permitted_reasoning_levels.add(level)

    model_response = client.delete(f"/api/work-tracker/models/{model.id}", headers=auth)
    assert model_response.status_code == 204
    assert not AgentModel.objects.filter(pk=model.id).exists()
    assert ReasoningLevel.objects.filter(pk=level.id).exists()

    second = AgentModel.objects.create(provider=provider, name="other-unused-model")
    second.permitted_reasoning_levels.add(level)
    level_response = client.delete(
        f"/api/work-tracker/reasoning-levels/{level.id}", headers=auth
    )
    assert level_response.status_code == 204
    assert not ReasoningLevel.objects.filter(pk=level.id).exists()
    assert AgentModel.objects.filter(pk=second.id).exists()


def test_deleting_a_model_or_reasoning_level_referenced_by_a_binding_conflicts(
    client, auth, task_type, state
):
    provider = Provider.objects.get(slug="codex")
    level = ReasoningLevel.objects.get(name="high")
    model = AgentModel.objects.create(provider=provider, name="gpt-protected")
    model.permitted_reasoning_levels.add(level)
    LaunchBinding.objects.create(
        issue_type=task_type,
        state=state,
        prompt="Implement the selected work item.",
        model=model,
        reasoning=level,
    )

    model_response = client.delete(f"/api/work-tracker/models/{model.id}", headers=auth)
    level_response = client.delete(
        f"/api/work-tracker/reasoning-levels/{level.id}", headers=auth
    )

    assert model_response.status_code == 409
    assert level_response.status_code == 409
    assert AgentModel.objects.filter(pk=model.id).exists()
    assert ReasoningLevel.objects.filter(pk=level.id).exists()


def test_unattended_capability_is_read_from_the_code_owned_provider_row(client, auth):
    provider = Provider.objects.get(slug="codex")
    assert provider_supports_unattended("codex") is True

    response = _patch(
        client,
        f"/api/work-tracker/providers/{provider.id}",
        {"supports_unattended": False},
        auth,
    )

    assert response.status_code == 200
    assert provider_supports_unattended("codex") is True


def test_startup_guard_detects_both_directions_of_catalog_drift():
    persisted = set(Provider.objects.values_list("slug", flat=True))

    with pytest.raises(ProviderCatalogDrift, match="adapters without Provider rows"):
        assert_provider_catalog_matches_adapters(persisted | {"missing-row"})

    Provider.objects.create(slug="missing-adapter")
    with pytest.raises(ProviderCatalogDrift, match="Provider rows without adapters"):
        assert_provider_catalog_matches_adapters(persisted)


def test_provider_identity_is_code_owned_and_only_activation_is_writable(
    client, auth
):
    provider = Provider.objects.get(slug="codex")

    create = _post(
        client,
        "/api/work-tracker/providers",
        {"slug": "missing-adapter", "activated": True},
        auth,
    )
    delete = client.delete(
        f"/api/work-tracker/providers/{provider.id}", headers=auth
    )
    patched = _patch(
        client,
        f"/api/work-tracker/providers/{provider.id}",
        {
            "slug": "missing-adapter",
            "supports_unattended": False,
            "activated": False,
        },
        auth,
    )

    assert create.status_code == 405
    assert delete.status_code == 405
    assert patched.status_code == 200
    provider.refresh_from_db()
    assert provider.slug == "codex"
    assert provider.supports_unattended is True
    assert provider.activated is False
    assert not Provider.objects.filter(slug="missing-adapter").exists()


def test_provider_capabilities_route_no_longer_resolves(client, auth):
    response = client.get(
        "/api/work-tracker/launch-bindings/provider-capabilities", headers=auth
    )
    assert response.status_code == 404

from unittest.mock import patch

import pytest

from apps.settings_store.models import AppSetting
from worktracker.models import AgentModel, Provider, ReasoningLevel


pytestmark = pytest.mark.django_db


@pytest.fixture
def auth(settings):
    settings.WORKTRACKER_API_TOKEN = "test-token"
    settings.WORKTRACKER_DISABLE_AUTH = False
    return {"x-api-key": "test-token"}


def test_missing_provider_catalog_combines_activation_with_the_global_default(
    client, auth
):
    response = client.get("/api/settings/provider-catalog", headers=auth)

    assert response.status_code == 200
    assert response.json() == {
        "value": {
            "activated_providers": ["claude", "codex", "gemini"],
            "global_default": None,
        }
    }


def test_global_default_round_trips_as_one_host_scoped_setting(client, auth):
    provider = Provider.objects.get(slug="codex")
    model = AgentModel.objects.create(provider=provider, name="gpt-5")
    reasoning, _ = ReasoningLevel.objects.get_or_create(name="high")
    model.permitted_reasoning_levels.add(reasoning)
    catalog = {
        "activated_providers": ["codex"],
        "global_default": {
            "provider": "codex",
            "model": "gpt-5",
            "reasoning": "high",
        }
    }

    response = client.put(
        "/api/settings/provider-catalog",
        data={"value": catalog},
        content_type="application/json",
        headers=auth,
    )

    assert response.status_code == 200
    assert response.json() == {"value": catalog}
    setting = AppSetting.objects.get()
    assert (setting.scope, setting.key) == ("host", "provider_catalog")
    assert client.get("/api/settings/provider-catalog", headers=auth).json() == {
        "value": catalog
    }


def test_provider_catalog_write_rolls_back_activation_when_setting_write_fails(
    client, auth
):
    before = dict(Provider.objects.values_list("slug", "activated"))

    with patch.object(
        AppSetting.objects,
        "update_or_create",
        side_effect=RuntimeError("setting write failed"),
    ), pytest.raises(RuntimeError, match="setting write failed"):
        client.put(
            "/api/settings/provider-catalog",
            data={
                "value": {
                    "activated_providers": ["codex"],
                    "global_default": None,
                }
            },
            content_type="application/json",
            headers=auth,
        )

    assert dict(Provider.objects.values_list("slug", "activated")) == before


def test_invalid_global_default_does_not_change_provider_activation(client, auth):
    before = dict(Provider.objects.values_list("slug", "activated"))

    response = client.put(
        "/api/settings/provider-catalog",
        data={
            "value": {
                "activated_providers": ["codex"],
                "global_default": {
                    "provider": "codex",
                    "model": "missing-model",
                    "reasoning": None,
                },
            }
        },
        content_type="application/json",
        headers=auth,
    )

    assert response.status_code == 422
    assert dict(Provider.objects.values_list("slug", "activated")) == before


def test_activation_impact_route_is_removed(client):
    response = client.post(
        "/api/settings/provider-catalog/impact",
        data={
            "value": {
                "activated_providers": [],
                "global_default": None,
            }
        },
        content_type="application/json",
    )

    assert response.status_code == 404

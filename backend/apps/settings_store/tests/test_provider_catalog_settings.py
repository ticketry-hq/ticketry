import pytest

from apps.settings_store.models import AppSetting
from worktracker.models import AgentModel, Provider, ReasoningLevel


pytestmark = pytest.mark.django_db


def test_missing_provider_catalog_has_only_the_global_default(client):
    response = client.get("/api/settings/provider-catalog")

    assert response.status_code == 200
    assert response.json() == {"value": {"global_default": None}}


def test_global_default_round_trips_as_one_host_scoped_setting(client):
    provider = Provider.objects.get(slug="codex")
    model = AgentModel.objects.create(provider=provider, name="gpt-5")
    model.permitted_reasoning_levels.add(ReasoningLevel.objects.get(name="high"))
    catalog = {
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
    )

    assert response.status_code == 200
    assert response.json() == {"value": catalog}
    setting = AppSetting.objects.get()
    assert (setting.scope, setting.key) == ("host", "provider_catalog")
    assert client.get("/api/settings/provider-catalog").json() == {"value": catalog}


def test_activation_impact_route_is_removed(client):
    response = client.post(
        "/api/settings/provider-catalog/impact",
        data={"value": {"global_default": None}},
        content_type="application/json",
    )

    assert response.status_code == 404

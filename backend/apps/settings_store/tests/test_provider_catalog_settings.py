import pytest

from apps.settings_store.models import AppSetting


pytestmark = pytest.mark.django_db


def test_missing_provider_catalog_uses_first_run_defaults(client):
    response = client.get("/api/settings/provider-catalog")

    assert response.status_code == 200
    assert response.json() == {
        "value": {
            "activated_providers": ["claude", "codex", "gemini"],
            "global_default": None,
        }
    }


def test_provider_catalog_round_trips_as_one_host_scoped_setting(client):
    catalog = {
        "activated_providers": ["claude", "codex"],
        "global_default": {
            "provider": "codex",
            "model": "gpt-5",
            "reasoning": "high",
        },
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


@pytest.mark.parametrize(
    "catalog",
    [
        {
            "activated_providers": ["claude", "agy"],
            "global_default": None,
        },
        {
            "activated_providers": ["claude"],
            "global_default": {
                "provider": "codex",
                "model": "gpt-5",
                "reasoning": "high",
            },
        },
        {
            "activated_providers": ["codex"],
            "global_default": {
                "provider": "codex",
                "model": "claude-opus-4",
                "reasoning": "high",
            },
        },
        {
            "activated_providers": ["gemini"],
            "global_default": {
                "provider": "gemini",
                "model": "gemini-2.5-pro",
                "reasoning": "high",
            },
        },
    ],
)
def test_provider_catalog_rejects_invalid_schema_without_persisting(client, catalog):
    response = client.put(
        "/api/settings/provider-catalog",
        data={"value": catalog},
        content_type="application/json",
    )

    assert response.status_code == 422
    assert not AppSetting.objects.exists()

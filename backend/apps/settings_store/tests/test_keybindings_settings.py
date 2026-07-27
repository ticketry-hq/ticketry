import pytest

from apps.settings_store.models import AppSetting


pytestmark = pytest.mark.django_db


def test_keybindings_round_trip_as_one_host_scoped_setting(client):
    overrides = [
        {
            "context": "global",
            "actionId": "settings",
            "chord": {
                "key": "k",
                "alt": False,
                "control": True,
                "meta": False,
                "shift": False,
            },
        }
    ]

    response = client.put(
        "/api/settings/keybindings",
        data={"value": overrides},
        content_type="application/json",
    )

    assert response.status_code == 200
    assert response.json() == {"value": overrides}
    assert AppSetting.objects.count() == 1
    setting = AppSetting.objects.get()
    assert (setting.scope, setting.key) == ("host", "keybindings")
    assert client.get("/api/settings/keybindings").json() == {"value": overrides}


def test_missing_or_malformed_keybindings_return_null(client):
    assert client.get("/api/settings/keybindings").json() == {"value": None}

    AppSetting.objects.create(
        scope="host",
        key="keybindings",
        value="{not-json",
        updated_at="2026-07-23T00:00:00+00:00",
    )

    assert client.get("/api/settings/keybindings").json() == {"value": None}

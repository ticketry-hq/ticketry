import json

import pytest

from apps.settings_store.models import AppSetting
from apps.settings_store.provider_catalog import (
    PROVIDER_CATALOG_KEY,
    PROVIDER_CATALOG_SCOPE,
    load_provider_catalog,
    parse_provider_catalog,
)


def test_legacy_activation_and_unknown_fields_do_not_reenter_the_settings_shape():
    catalog = parse_provider_catalog(
        json.dumps(
            {
                "activated_providers": ["claude"],
                "global_default": {"provider": "claude", "model": "opus"},
                "unexpected_field": 1,
            }
        )
    )

    assert catalog.model_dump(mode="json") == {
        "global_default": {
            "provider": "claude",
            "model": "opus",
            "reasoning": None,
        }
    }


def test_invalid_default_is_dropped_without_reintroducing_activation():
    catalog = parse_provider_catalog(
        json.dumps({"global_default": {"provider": "future-provider"}})
    )

    assert catalog.model_dump(mode="json") == {"global_default": None}


def test_unrecoverable_data_falls_back_to_no_default_loudly(caplog):
    with caplog.at_level("ERROR"):
        catalog = parse_provider_catalog("not json at all")

    assert catalog.model_dump(mode="json") == {"global_default": None}
    assert "provider catalog" in caplog.text


@pytest.mark.django_db
def test_settings_view_and_launch_accessor_salvage_the_same_default(client):
    AppSetting.objects.create(
        scope=PROVIDER_CATALOG_SCOPE,
        key=PROVIDER_CATALOG_KEY,
        value=json.dumps(
            {
                "activated_providers": ["claude"],
                "global_default": {"provider": "claude", "model": "opus"},
                "unexpected_field": 1,
            }
        ),
        updated_at="2026-07-27T00:00:00+00:00",
    )

    expected = {
        "global_default": {
            "provider": "claude",
            "model": "opus",
            "reasoning": None,
        }
    }
    assert load_provider_catalog().model_dump(mode="json") == expected
    assert client.get("/api/settings/provider-catalog").json() == {"value": expected}

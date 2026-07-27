"""Activation is a gate, so an unreadable catalog must never fail open.

``ProviderCatalog()`` defaults to *every* provider activated, so returning it
from a parse failure silently widens activation to maximum. These pin the
salvage: narrow on bad data, and never widen without saying so.
"""

import json

import pytest

from apps.settings_store.models import AppSetting
from apps.settings_store.provider_catalog import (
    PROVIDER_CATALOG_KEY,
    PROVIDER_CATALOG_SCOPE,
    load_provider_catalog,
    parse_provider_catalog,
)


def test_an_unknown_field_keeps_the_stored_activation_set():
    """``extra="forbid"`` means a newer build's field breaks an older read."""

    catalog = parse_provider_catalog(
        json.dumps({"activated_providers": ["claude"], "unexpected_field": 1})
    )

    assert catalog.activated_providers == frozenset({"claude"})


def test_an_unknown_provider_slug_is_dropped_not_widened():
    catalog = parse_provider_catalog(
        json.dumps({"activated_providers": ["claude", "future-provider"]})
    )

    assert catalog.activated_providers == frozenset({"claude"})


def test_a_default_the_activation_set_rejects_drops_only_the_default():
    """The cross-field validator rejects the whole document; salvage does not.

    Discarding the activation set alongside the offending default is what
    re-activated every provider — the nastier half of the failure.
    """

    catalog = parse_provider_catalog(
        json.dumps(
            {
                "activated_providers": ["claude"],
                "global_default": {"provider": "gemini"},
            }
        )
    )

    assert catalog.activated_providers == frozenset({"claude"})
    assert catalog.global_default is None


def test_a_valid_default_survives_an_unknown_field():
    catalog = parse_provider_catalog(
        json.dumps(
            {
                "activated_providers": ["claude"],
                "global_default": {"provider": "claude", "model": "opus"},
                "unexpected_field": 1,
            }
        )
    )

    assert catalog.activated_providers == frozenset({"claude"})
    assert catalog.global_default is not None
    assert catalog.global_default.model == "opus"


def test_unrecoverable_data_falls_back_to_first_run_defaults_loudly(caplog):
    with caplog.at_level("ERROR"):
        catalog = parse_provider_catalog("not json at all")

    assert catalog.activated_providers == frozenset({"claude", "codex", "gemini"})
    assert "provider catalog" in caplog.text


@pytest.mark.django_db
def test_the_launch_path_and_the_settings_view_salvage_identically(client):
    """Two copies of a security-relevant fallback would drift (L1)."""

    AppSetting.objects.create(
        scope=PROVIDER_CATALOG_SCOPE,
        key=PROVIDER_CATALOG_KEY,
        value=json.dumps({"activated_providers": ["claude"], "unexpected_field": 1}),
        updated_at="2026-07-27T00:00:00+00:00",
    )

    assert load_provider_catalog().activated_providers == frozenset({"claude"})
    assert client.get("/api/settings/provider-catalog").json() == {
        "value": {"activated_providers": ["claude"], "global_default": None}
    }

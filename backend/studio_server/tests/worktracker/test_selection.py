"""Local configuration selection stays independent of WorkTracker queries."""

import json

import pytest
from django.test import RequestFactory

from apps.settings_store import config as config_module
from apps.settings_store.config import NoConfigurationSelected, resolve_profile
from studio_server.api import no_profile_selected


def test_resolve_profile_uses_recent_profile_index(tmp_path, monkeypatch):
    config_dir = tmp_path / "settings"
    config_file = config_dir / "profiles.json"
    monkeypatch.setattr(config_module, "CONFIG_DIR", config_dir)
    monkeypatch.setattr(config_module, "CONFIG_FILE", config_file)
    config_dir.mkdir()
    config_file.write_text(
        json.dumps(
            {
                "recent_profile_index": 1,
                "profiles": [
                    {"name": "First", "workspace_slug": "meml"},
                    {"name": "Selected", "workspace_slug": "meml"},
                ],
            }
        )
    )

    assert resolve_profile(None).name == "Selected"


def test_resolve_profile_reports_missing_local_configuration(tmp_path, monkeypatch):
    monkeypatch.setattr(config_module, "CONFIG_DIR", tmp_path)
    monkeypatch.setattr(config_module, "CONFIG_FILE", tmp_path / "profiles.json")

    with pytest.raises(NoConfigurationSelected):
        resolve_profile(None)


def test_no_configuration_selected_preserves_http_error_contract():
    response = no_profile_selected(
        RequestFactory().get("/api/config"),
        NoConfigurationSelected("No profile selected."),
    )

    assert response.status_code == 400
    assert json.loads(response.content) == {
        "detail": {
            "error": "no_profile_selected",
            "message": "No profile selected.",
        }
    }


def test_terminal_profile_index_uses_settings_selector(tmp_path, monkeypatch):
    from apps.terminals import prompt_builder

    config_dir = tmp_path / "settings"
    config_file = config_dir / "profiles.json"
    monkeypatch.setattr(config_module, "CONFIG_DIR", config_dir)
    monkeypatch.setattr(config_module, "CONFIG_FILE", config_file)
    config_dir.mkdir()
    config_file.write_text(
        json.dumps(
            {
                "recent_profile_index": 0,
                "profiles": [{"name": "First", "workspace_slug": "meml"}],
            }
        )
    )

    assert prompt_builder._resolve_profile_index() == 0

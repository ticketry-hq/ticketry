import json

import pytest


def test_ensure_local_profile_creates_once_and_refreshes_shared_config(
    tmp_config,
    monkeypatch,
):
    from apps.settings_store import config as config_module
    from apps.settings_store import service

    monkeypatch.setattr(config_module.config, "profiles", [])
    monkeypatch.setattr(config_module.config, "recent_profile_index", None)

    first = service.ensure_local_profile(name="Local", workspace_slug="meml")
    second = service.ensure_local_profile(name="Ignored", workspace_slug="other")

    assert first == second
    assert first["recent_profile_index"] == 0
    assert first["profiles"][0]["name"] == "Local"
    assert config_module.config.profiles[0].workspace_slug == "meml"
    assert json.loads(tmp_config.read_text())["profiles"] == first["profiles"]


def test_get_config_empty(client):
    response = client.get("/api/config")
    assert response.status_code == 200
    body = response.json()
    assert body["recent_profile_index"] is None
    assert body["profiles"] == []
    assert body["features"] == {"sidebar": False, "projects": False}
    assert "default_agent_prompts" not in body


@pytest.mark.parametrize(
    ("contents", "expected"),
    [
        (
            '{"sidebar": false, "projects": true}',
            {"sidebar": False, "projects": False},
        ),
        (
            '{"sidebar": true, "projects": true}',
            {"sidebar": True, "projects": True},
        ),
        (
            '{"sidebar": true, "projects": false}',
            {"sidebar": True, "projects": False},
        ),
        ('{"projects": true}', {"sidebar": False, "projects": False}),
        ('{"sidebar": true}', {"sidebar": True, "projects": False}),
        ("{}", {"sidebar": False, "projects": False}),
        ("", {"sidebar": False, "projects": False}),
        ("not json", {"sidebar": False, "projects": False}),
        ("[]", {"sidebar": False, "projects": False}),
        (
            '{"sidebar": true, "projects": true, "newer_flag": true}',
            {"sidebar": True, "projects": True},
        ),
    ],
)
def test_get_config_loads_features_at_process_start(
    client, tmp_config, contents, expected, monkeypatch
):
    from apps.settings_store import config as config_module

    features_file = tmp_config.with_name("features.json")
    features_file.parent.mkdir(parents=True, exist_ok=True)
    features_file.write_text(contents)
    monkeypatch.setattr(config_module, "features", config_module.load_features())

    response = client.get("/api/config")

    assert response.status_code == 200
    assert response.json()["features"] == expected


def test_get_config_defaults_unreadable_features_file(client, tmp_config, monkeypatch):
    from apps.settings_store import config as config_module

    features_file = tmp_config.with_name("features.json")
    features_file.parent.mkdir(parents=True, exist_ok=True)
    features_file.write_text('{"sidebar": true, "projects": true}')
    original_read_text = type(features_file).read_text

    def unreadable(path, *args, **kwargs):
        if path == features_file:
            raise PermissionError("unreadable")
        return original_read_text(path, *args, **kwargs)

    monkeypatch.setattr(type(features_file), "read_text", unreadable)
    monkeypatch.setattr(config_module, "features", config_module.load_features())

    response = client.get("/api/config")

    assert response.status_code == 200
    assert response.json()["features"] == {"sidebar": False, "projects": False}


def test_features_are_unchanged_until_process_restart(client, tmp_config, monkeypatch):
    from apps.settings_store import config as config_module

    features_file = tmp_config.with_name("features.json")
    features_file.parent.mkdir(parents=True, exist_ok=True)
    features_file.write_text('{"sidebar": true, "projects": false}')
    monkeypatch.setattr(config_module, "features", config_module.load_features())
    assert client.get("/api/config").json()["features"] == {
        "sidebar": True,
        "projects": False,
    }

    features_file.write_text('{"sidebar": true, "projects": true}')
    assert client.get("/api/config").json()["features"] == {
        "sidebar": True,
        "projects": False,
    }

    monkeypatch.setattr(config_module, "features", config_module.load_features())
    assert client.get("/api/config").json()["features"] == {
        "sidebar": True,
        "projects": True,
    }


def test_round_trip_profile_crud(client, tmp_config, sample_profile):
    response = client.post(
        "/api/config/profiles",
        data=sample_profile,
        content_type="application/json",
    )
    assert response.status_code == 200
    body = response.json()
    assert len(body["profiles"]) == 1
    assert body["profiles"][0]["name"] == "Default"
    assert set(body["profiles"][0]) == {
        "name",
        "workspace_slug",
        "agent_prompt",
        "agent_prompts",
        "module_links",
        "recent_project_id",
        "recent_module_ids",
    }

    on_disk = json.loads(tmp_config.read_text())
    assert set(on_disk["profiles"][0]) == set(body["profiles"][0])
    assert on_disk["profiles"][0]["module_links"] == []

    updated = {**sample_profile, "name": "Renamed"}
    response = client.put(
        "/api/config/profiles/0",
        data=updated,
        content_type="application/json",
    )
    assert response.status_code == 200
    assert response.json()["profiles"][0]["name"] == "Renamed"

    response = client.patch(
        "/api/config",
        data={"recent_profile_index": 0},
        content_type="application/json",
    )
    assert response.status_code == 200
    assert response.json()["recent_profile_index"] == 0

    response = client.patch(
        "/api/config",
        data={"recent_profile_index": 5},
        content_type="application/json",
    )
    assert response.status_code == 400
    assert response.json() == {"detail": {"error": "index_out_of_range"}}
    assert response.content == b'{"detail":{"error":"index_out_of_range"}}'

    response = client.delete("/api/config/profiles/0")
    assert response.status_code == 200
    assert response.json()["profiles"] == []
    assert response.json()["recent_profile_index"] is None


def test_profile_module_links_round_trip_canonically(client, tmp_config, sample_profile):
    linked_profile = {
        **sample_profile,
        "module_links": [
            {"module_id": "module-one", "path": "/repos/one"},
            {"module_id": "module-two", "path": "/repos/two"},
        ],
        "recent_project_id": "project-one",
        "recent_module_ids": {"project-one": "module-two"},
    }

    response = client.post(
        "/api/config/profiles",
        data=linked_profile,
        content_type="application/json",
    )

    assert response.status_code == 200
    assert response.json()["profiles"] == [linked_profile]
    assert json.loads(tmp_config.read_text())["profiles"] == [linked_profile]
    assert client.get("/api/config").json()["profiles"] == [linked_profile]


def test_profile_writes_reject_legacy_module_folders(client, sample_profile):
    legacy_profile = {
        key: value for key, value in sample_profile.items() if key != "module_links"
    }
    legacy_profile["module_folders"] = {"module-one": "/repos/one"}

    response = client.post(
        "/api/config/profiles",
        data=legacy_profile,
        content_type="application/json",
    )

    assert response.status_code == 422


def test_profile_writes_reject_features_and_do_not_disturb_file(
    client, tmp_config, sample_profile, monkeypatch
):
    from apps.settings_store import config as config_module

    features_file = tmp_config.with_name("features.json")
    features_contents = (
        '{"sidebar": true, "projects": true, "newer_flag": false}\n'
    )
    features_file.parent.mkdir(parents=True, exist_ok=True)
    features_file.write_text(features_contents)
    monkeypatch.setattr(config_module, "features", config_module.load_features())

    response = client.post(
        "/api/config/profiles",
        data={**sample_profile, "features": {"projects": False}},
        content_type="application/json",
    )

    assert response.status_code == 422
    assert features_file.read_text() == features_contents
    assert client.get("/api/config").json()["features"] == {
        "sidebar": True,
        "projects": True,
    }

    response = client.post(
        "/api/config/profiles",
        data=sample_profile,
        content_type="application/json",
    )
    assert response.status_code == 200
    assert "features" not in response.json()
    assert features_file.read_text() == features_contents
    assert client.get("/api/config").json()["features"] == {
        "sidebar": True,
        "projects": True,
    }

    response = client.put(
        "/api/config/profiles/0",
        data={**sample_profile, "features": {"projects": False}},
        content_type="application/json",
    )
    assert response.status_code == 422
    assert features_file.read_text() == features_contents
    assert client.get("/api/config").json()["features"] == {
        "sidebar": True,
        "projects": True,
    }

    response = client.delete("/api/config/profiles/0")
    assert response.status_code == 200
    assert "features" not in response.json()
    assert features_file.read_text() == features_contents
    assert client.get("/api/config").json()["features"] == {
        "sidebar": True,
        "projects": True,
    }


def test_profile_optional_fields_use_source_defaults(client):
    response = client.post(
        "/api/config/profiles",
        data={
            "name": "Minimal",
            "workspace_slug": "workspace",
        },
        content_type="application/json",
    )

    assert response.status_code == 200
    assert response.json()["profiles"] == [
        {
            "name": "Minimal",
            "workspace_slug": "workspace",
            "agent_prompt": None,
            "agent_prompts": {},
            "module_links": [],
            "recent_project_id": None,
            "recent_module_ids": {},
        }
    ]


def test_get_config_preserves_recent_profile_index(
    client, tmp_config, sample_profile
):
    first = {**sample_profile, "name": "First"}
    second = {**sample_profile, "name": "Second"}
    tmp_config.parent.mkdir(parents=True, exist_ok=True)
    tmp_config.write_text(
        json.dumps({"recent_profile_index": 0, "profiles": [first, second]})
    )

    response = client.get("/api/config")

    assert response.status_code == 200
    assert response.json()["recent_profile_index"] == 0
    assert json.loads(tmp_config.read_text())["recent_profile_index"] == 0


def test_delete_shifts_recent(client, tmp_config, sample_profile):
    client.post(
        "/api/config/profiles",
        data=sample_profile,
        content_type="application/json",
    )
    client.post(
        "/api/config/profiles",
        data={**sample_profile, "name": "Second"},
        content_type="application/json",
    )
    client.patch(
        "/api/config",
        data={"recent_profile_index": 1},
        content_type="application/json",
    )

    response = client.delete("/api/config/profiles/1")
    assert response.status_code == 200
    assert response.json()["recent_profile_index"] == 0

    client.post(
        "/api/config/profiles",
        data={**sample_profile, "name": "Second"},
        content_type="application/json",
    )
    client.patch(
        "/api/config",
        data={"recent_profile_index": 1},
        content_type="application/json",
    )
    response = client.delete("/api/config/profiles/0")
    assert response.status_code == 200
    assert response.json()["recent_profile_index"] == 0


def test_replace_and_delete_out_of_range_error_shape(client, sample_profile):
    response = client.put(
        "/api/config/profiles/0",
        data=sample_profile,
        content_type="application/json",
    )
    assert response.status_code == 400
    assert response.json() == {"detail": {"error": "index_out_of_range"}}

    response = client.delete("/api/config/profiles/0")
    assert response.status_code == 400
    assert response.json() == {"detail": {"error": "index_out_of_range"}}

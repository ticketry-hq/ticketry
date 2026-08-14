"""Legacy settings load into the canonical profile-link contract."""

import json

from apps.settings_store.config import Config, resolve_profile_index


def test_current_module_links_round_trip_by_profile(tmp_config):
    payload = {
        "recent_profile_index": 1,
        "profiles": [
            {
                "name": "Laptop",
                "workspace_slug": "meml",
                "agent_prompt": "Keep changes focused.",
                "agent_prompts": {"codex": "Use tests."},
                "module_links": [
                    {"module_id": "not-validated-as-a-uuid", "path": "/src/one"},
                ],
                "recent_project_id": "project-one",
                "recent_module_ids": {"project-one": "not-validated-as-a-uuid"},
            },
            {
                "name": "Desktop",
                "workspace_slug": "meml",
                "module_links": [
                    {"module_id": "module-two", "path": "/work/two"},
                ],
                "recent_project_id": "project-two",
                "recent_module_ids": {"project-two": "module-two"},
            },
        ],
    }
    tmp_config.parent.mkdir(parents=True, exist_ok=True)
    tmp_config.write_text(json.dumps(payload))

    config = Config()
    config.save_profiles()

    stored = json.loads(tmp_config.read_text())
    assert stored["recent_profile_index"] == 1
    assert [profile["name"] for profile in stored["profiles"]] == [
        "Laptop",
        "Desktop",
    ]
    assert stored["profiles"][0] == payload["profiles"][0]
    assert stored["profiles"][1] == {
        **payload["profiles"][1],
        "agent_prompt": None,
        "agent_prompts": {},
    }
    assert resolve_profile_index(config, None) == 1
    assert all("id" not in profile for profile in stored["profiles"])

    reloaded = Config()
    assert reloaded.recent_profile_index == 1
    assert [profile.module_links for profile in reloaded.profiles] == [
        payload["profiles"][0]["module_links"],
        payload["profiles"][1]["module_links"],
    ]


def test_legacy_module_folders_migrate_every_profile_and_save_canonically(
    tmp_config,
):
    legacy = {
        "recent_profile_index": 1,
        "profiles": [
            {
                "name": "Laptop",
                "workspace_slug": "meml",
                "agent_prompt": "Laptop prompt",
                "agent_prompts": {"codex": "Laptop Codex prompt"},
                "module_folders": {
                    "module-a": "/Users/example/src/a",
                    "module-b": "/Users/example/src/b",
                },
                "recent_project_id": "project-a",
                "recent_module_ids": {
                    "project-a": "module-b",
                    "project-b": "module-a",
                },
            },
            {
                "name": "Empty profile",
                "workspace_slug": "other",
                "agent_prompt": None,
                "agent_prompts": {},
                "module_folders": {},
                "recent_project_id": None,
                "recent_module_ids": {},
            },
        ],
    }
    tmp_config.parent.mkdir(parents=True, exist_ok=True)
    tmp_config.write_text(json.dumps(legacy))

    config = Config()

    assert config.profiles[0].module_links == [
        {"module_id": "module-a", "path": "/Users/example/src/a"},
        {"module_id": "module-b", "path": "/Users/example/src/b"},
    ]
    assert config.profiles[1].module_links == []
    assert not hasattr(config.profiles[0], "module_folders")
    assert not hasattr(config.profiles[1], "module_folders")

    config.save_profiles()

    stored = json.loads(tmp_config.read_text())
    assert stored["recent_profile_index"] == legacy["recent_profile_index"]
    assert all("module_folders" not in profile for profile in stored["profiles"])
    legacy_first_without_folders = dict(legacy["profiles"][0])
    legacy_first_without_folders.pop("module_folders")
    assert stored["profiles"][0] == {
        **legacy_first_without_folders,
        "module_links": config.profiles[0].module_links,
    }
    legacy_second_without_folders = dict(legacy["profiles"][1])
    legacy_second_without_folders.pop("module_folders")
    assert stored["profiles"][1] == {
        **legacy_second_without_folders,
        "module_links": [],
    }


def test_canonical_links_win_over_stale_legacy_field(tmp_config):
    tmp_config.parent.mkdir(parents=True, exist_ok=True)
    tmp_config.write_text(
        json.dumps(
            {
                "recent_profile_index": 0,
                "profiles": [
                    {
                        "name": "Current",
                        "workspace_slug": "meml",
                        "module_links": [
                            {"module_id": "module-a", "path": "/current"},
                        ],
                        "module_folders": {"module-a": "/stale"},
                    }
                ],
            }
        )
    )

    config = Config()

    assert config.profiles[0].module_links == [
        {"module_id": "module-a", "path": "/current"},
    ]
    assert not hasattr(config.profiles[0], "module_folders")

import json

from apps.settings_store.compatibility import read_config, read_profile


def test_compatibility_reads_fresh_rust_owned_profile_without_writing(tmp_config):
    first = {
        "recent_profile_index": 0,
        "profiles": [
            {
                "name": "First",
                "workspace_slug": "meml",
                "module_links": [{"module_id": "module-a", "path": "/src/a"}],
                "recent_project_id": "project-a",
                "recent_module_ids": {"project-a": "module-a"},
            }
        ],
    }
    tmp_config.parent.mkdir(parents=True, exist_ok=True)
    tmp_config.write_text(json.dumps(first))

    assert read_profile().name == "First"
    assert read_config().profiles[0].module_links[0]["path"] == "/src/a"
    assert json.loads(tmp_config.read_text()) == first

    second = {
        **first,
        "profiles": [
            {
                **first["profiles"][0],
                "name": "Rust update",
                "module_links": [
                    {"module_id": "module-a", "path": "/src/current"}
                ],
            }
        ],
    }
    tmp_config.write_text(json.dumps(second))

    assert read_profile().name == "Rust update"
    assert read_profile().module_links[0]["path"] == "/src/current"
    assert json.loads(tmp_config.read_text()) == second

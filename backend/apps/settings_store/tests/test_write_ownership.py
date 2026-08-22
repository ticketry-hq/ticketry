import json
from pathlib import Path

import pytest
from django.http import HttpResponse
from django.test import RequestFactory

from apps.settings_store.config import Config
from apps.settings_store.write_ownership import (
    RUST_OWNER_ENV,
    RustSlice2WriteOwnershipMiddleware,
    slice2_commands_ready,
)


def guarded_response(method: str, path: str):
    request = getattr(RequestFactory(), method.lower())(
        path,
        data={},
        content_type="application/json",
    )
    return RustSlice2WriteOwnershipMiddleware(
        lambda _request: HttpResponse(status=204)
    )(request)


@pytest.mark.parametrize(
    ("method", "path"),
    (
        ("PUT", "/api/settings/keybindings"),
        ("PUT", "/api/settings/provider-catalog"),
        ("PATCH", "/api/config"),
        ("POST", "/api/config/profiles"),
        ("PATCH", "/api/work-tracker/providers/provider-id"),
        ("POST", "/api/work-tracker/models"),
        ("DELETE", "/api/work-tracker/reasoning-levels/reasoning-id"),
    ),
)
def test_rust_owner_disables_every_legacy_slice2_route(monkeypatch, method, path):
    monkeypatch.setenv(RUST_OWNER_ENV, "1")

    response = guarded_response(method, path)

    assert response.status_code == 410
    assert json.loads(response.content)["code"] == "django_slice2_write_disabled"


def test_rust_owner_keeps_reads_available(monkeypatch):
    monkeypatch.setenv(RUST_OWNER_ENV, "1")

    assert guarded_response("GET", "/api/config").status_code == 204
    assert guarded_response("GET", "/api/work-tracker/providers").status_code == 204


def test_non_http_profile_writer_is_also_disabled(monkeypatch, tmp_path):
    monkeypatch.setenv(RUST_OWNER_ENV, "1")
    config = Config.__new__(Config)
    config.profiles = []
    config.recent_profile_index = None

    with pytest.raises(RuntimeError, match="django_slice2_write_disabled"):
        config.save_profiles()

    assert not tmp_path.joinpath("profiles.json").exists()


def test_command_readiness_requires_exact_boolean_types(monkeypatch, tmp_path):
    monkeypatch.setenv(RUST_OWNER_ENV, "1")
    monkeypatch.setenv("MUXED_DATA_DIR", str(tmp_path))
    (tmp_path / "slice2-readiness.json").write_text(
        json.dumps(
            {
                "version": 1,
                "ownership": True,
                "graphql": True,
                "rust_mcp": 1,
                "django_effect_port": True,
                "ready": True,
                "django_write_fallback": False,
            }
        )
    )

    assert not slice2_commands_ready()


def test_production_writer_audit_has_only_explicitly_guarded_legacy_seams():
    backend = Path(__file__).resolve().parents[3]
    allowed = {
        Path("apps/settings_store/api.py"),
        Path("apps/settings_store/config.py"),
        Path("apps/settings_store/dao.py"),
        Path("apps/settings_store/profile_prompt_migration.py"),
        Path("worktracker/seed.py"),
    }
    signatures = (
        "AppSetting.objects.aupdate_or_create",
        "AppSetting.objects.update_or_create",
        "Provider.objects.filter(slug=slug).update",
        "LaunchBinding.objects.using(using).get_or_create",
        "atomic_write_json(CONFIG_FILE",
        "atomic_write_json(config_file",
    )
    observed = set()
    for path in backend.rglob("*.py"):
        relative = path.relative_to(backend)
        if (
            "migrations" in relative.parts
            or "tests" in relative.parts
            or path.name == "conftest.py"
        ):
            continue
        source = path.read_text()
        if any(signature in source for signature in signatures):
            observed.add(relative)

    assert observed == allowed
    for relative in allowed:
        source = (backend / relative).read_text()
        assert (
            "assert_django_settings_write_allowed" in source
            or "save_profiles()" in source
        )

    signal_and_adapter_sources = "\n".join(
        path.read_text()
        for root in (backend / "worktracker", backend / "apps/terminals/agents")
        for path in root.rglob("*.py")
        if "migrations" not in path.parts and "tests" not in path.parts
        and (path.name == "signals.py" or "agents" in path.parts)
    )
    forbidden_writer_calls = (
        "AppSetting.objects.create",
        "AppSetting.objects.update_or_create",
        "AppSetting.objects.aupdate_or_create",
        "Provider.objects.create",
        "Provider.objects.update_or_create",
        "LaunchBinding.objects.create",
        "LaunchBinding.objects.get_or_create",
        "LaunchBinding.objects.update_or_create",
    )
    assert not any(
        call in signal_and_adapter_sources for call in forbidden_writer_calls
    )

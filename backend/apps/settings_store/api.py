"""Transport-independent settings application operations used by DRF."""

import json
from datetime import datetime, timezone

from apps.errors import ApplicationError
from apps.settings_store import service
from apps.settings_store.models import AppSetting
from apps.settings_store.provider_catalog import (
    GlobalLaunchDefault,
    PROVIDER_CATALOG_KEY,
    PROVIDER_CATALOG_SCOPE,
    ProviderCatalog,
    parse_provider_catalog,
    validate_global_launch_default,
)


KEYBINDINGS_SCOPE = "host"
KEYBINDINGS_KEY = "keybindings"


def _raise_index_out_of_range() -> None:
    raise ApplicationError(
        400,
        "index_out_of_range",
        code="index_out_of_range",
    )


def _get_setting(scope: str, key: str) -> str | None:
    return (
        AppSetting.objects.filter(scope=scope, key=key)
        .values_list("value", flat=True)
        .first()
    )


def _upsert_setting(*, scope: str, key: str, value: str) -> None:
    AppSetting.objects.update_or_create(
        scope=scope,
        key=key,
        defaults={
            "value": value,
            "updated_at": datetime.now(timezone.utc).isoformat(),
        },
    )


def get_keybindings():
    value = _get_setting(KEYBINDINGS_SCOPE, KEYBINDINGS_KEY)
    if value is None:
        return {"value": None}
    try:
        return {"value": json.loads(value)}
    except json.JSONDecodeError:
        return {"value": None}


def put_keybindings(*, value):
    _upsert_setting(
        scope=KEYBINDINGS_SCOPE,
        key=KEYBINDINGS_KEY,
        value=json.dumps(value),
    )
    return {"value": value}


def get_provider_catalog():
    value = _get_setting(PROVIDER_CATALOG_SCOPE, PROVIDER_CATALOG_KEY)
    catalog = ProviderCatalog() if value is None else parse_provider_catalog(value)
    return {"value": catalog.as_dict()}


def put_provider_catalog(*, value: dict):
    default_data = value.get("global_default")
    default = None if default_data is None else GlobalLaunchDefault(**default_data)
    try:
        validate_global_launch_default(default)
    except ValueError as exc:
        raise ApplicationError(422, str(exc)) from exc
    _upsert_setting(
        scope=PROVIDER_CATALOG_SCOPE,
        key=PROVIDER_CATALOG_KEY,
        value=json.dumps(value),
    )
    return {"value": value}


def get_config():
    return service.list_config()


def add_profile(data: dict):
    return service.add_profile(data)


def replace_profile(index: int, data: dict):
    try:
        return service.replace_profile(index, data)
    except service.IndexOutOfRange:
        _raise_index_out_of_range()


def delete_profile(index: int):
    try:
        return service.delete_profile(index)
    except service.IndexOutOfRange:
        _raise_index_out_of_range()


def patch_config(*, recent_profile_index: int):
    try:
        return service.set_recent_index(recent_profile_index)
    except service.IndexOutOfRange:
        _raise_index_out_of_range()

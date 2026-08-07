"""Transport-independent settings application operations used by DRF."""

import json
from datetime import datetime, timezone
from typing import Any

from asgiref.sync import sync_to_async
from pydantic import BaseModel

from apps.errors import ApplicationError
from apps.settings_store import dao, service
from apps.settings_store.provider_catalog import (
    PROVIDER_CATALOG_KEY,
    PROVIDER_CATALOG_SCOPE,
    ProviderCatalog,
    parse_provider_catalog,
    validate_global_launch_default,
)
from apps.settings_store.schemas import ProfileBody


KEYBINDINGS_SCOPE = "host"
KEYBINDINGS_KEY = "keybindings"


class SettingValueBody(BaseModel):
    value: Any


class ProviderCatalogBody(BaseModel):
    value: ProviderCatalog


class RecentIndexBody(BaseModel):
    recent_profile_index: int


def _raise_index_out_of_range() -> None:
    raise ApplicationError(
        400,
        "index_out_of_range",
        code="index_out_of_range",
    )


async def get_keybindings():
    value = await dao.get_setting(KEYBINDINGS_SCOPE, KEYBINDINGS_KEY)
    if value is None:
        return {"value": None}
    try:
        return {"value": json.loads(value)}
    except json.JSONDecodeError:
        return {"value": None}


async def put_keybindings(body: SettingValueBody):
    await dao.upsert_setting(
        scope=KEYBINDINGS_SCOPE,
        key=KEYBINDINGS_KEY,
        value=json.dumps(body.value),
        updated_at=datetime.now(timezone.utc).isoformat(),
    )
    return {"value": body.value}


async def get_provider_catalog():
    value = await dao.get_setting(PROVIDER_CATALOG_SCOPE, PROVIDER_CATALOG_KEY)
    catalog = ProviderCatalog() if value is None else parse_provider_catalog(value)
    return {"value": catalog.model_dump(mode="json")}


async def put_provider_catalog(body: ProviderCatalogBody):
    try:
        await sync_to_async(validate_global_launch_default)(body.value.global_default)
    except ValueError as exc:
        raise ApplicationError(422, str(exc)) from exc
    await dao.upsert_setting(
        scope=PROVIDER_CATALOG_SCOPE,
        key=PROVIDER_CATALOG_KEY,
        value=body.value.model_dump_json(),
        updated_at=datetime.now(timezone.utc).isoformat(),
    )
    return {"value": body.value.model_dump(mode="json")}


async def get_config():
    return service.list_config()


async def add_profile(body: ProfileBody):
    return service.add_profile(body.model_dump())


async def replace_profile(index: int, body: ProfileBody):
    try:
        return service.replace_profile(index, body.model_dump())
    except service.IndexOutOfRange:
        _raise_index_out_of_range()


async def delete_profile(index: int):
    try:
        return service.delete_profile(index)
    except service.IndexOutOfRange:
        _raise_index_out_of_range()


async def patch_config(body: RecentIndexBody):
    try:
        return service.set_recent_index(body.recent_profile_index)
    except service.IndexOutOfRange:
        _raise_index_out_of_range()

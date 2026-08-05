import json
from datetime import datetime, timezone
from typing import Any

from asgiref.sync import sync_to_async
from django.http import JsonResponse
from ninja import Router
from ninja.errors import HttpError
from pydantic import BaseModel

from apps.settings_store import dao, service
from apps.settings_store.provider_catalog import (
    PROVIDER_CATALOG_KEY,
    PROVIDER_CATALOG_SCOPE,
    ProviderCatalog,
    parse_provider_catalog,
    validate_global_launch_default,
)
from apps.settings_store.schemas import ConfigBody, ProfileBody


router = Router(tags=["system"])

KEYBINDINGS_SCOPE = "host"
KEYBINDINGS_KEY = "keybindings"


class SettingValueBody(BaseModel):
    value: Any


class ProviderCatalogBody(BaseModel):
    value: ProviderCatalog


class RecentIndexBody(BaseModel):
    recent_profile_index: int


def _index_out_of_range_response() -> JsonResponse:
    return JsonResponse(
        {"detail": {"error": "index_out_of_range"}},
        status=400,
        json_dumps_params={"separators": (",", ":")},
    )


@router.get("/settings/keybindings")
async def get_keybindings(request):
    value = await dao.get_setting(KEYBINDINGS_SCOPE, KEYBINDINGS_KEY)
    if value is None:
        return {"value": None}
    try:
        return {"value": json.loads(value)}
    except json.JSONDecodeError:
        return {"value": None}


@router.put("/settings/keybindings")
async def put_keybindings(request, body: SettingValueBody):
    await dao.upsert_setting(
        scope=KEYBINDINGS_SCOPE,
        key=KEYBINDINGS_KEY,
        value=json.dumps(body.value),
        updated_at=datetime.now(timezone.utc).isoformat(),
    )
    return {"value": body.value}


@router.get("/settings/provider-catalog", response=ProviderCatalogBody)
async def get_provider_catalog(request):
    value = await dao.get_setting(PROVIDER_CATALOG_SCOPE, PROVIDER_CATALOG_KEY)
    catalog = ProviderCatalog() if value is None else parse_provider_catalog(value)
    return {"value": catalog.model_dump(mode="json")}


@router.put("/settings/provider-catalog", response=ProviderCatalogBody)
async def put_provider_catalog(request, body: ProviderCatalogBody):
    try:
        await sync_to_async(validate_global_launch_default)(
            body.value.global_default
        )
    except ValueError as exc:
        raise HttpError(422, str(exc)) from exc
    await dao.upsert_setting(
        scope=PROVIDER_CATALOG_SCOPE,
        key=PROVIDER_CATALOG_KEY,
        value=body.value.model_dump_json(),
        updated_at=datetime.now(timezone.utc).isoformat(),
    )
    return {"value": body.value.model_dump(mode="json")}


@router.get("/config", response=ConfigBody)
async def get_config(request):
    return service.list_config()


@router.post("/config/profiles")
async def add_profile(request, body: ProfileBody):
    return service.add_profile(body.model_dump())


@router.put("/config/profiles/{index}")
async def replace_profile(request, index: int, body: ProfileBody):
    try:
        return service.replace_profile(index, body.model_dump())
    except service.IndexOutOfRange:
        return _index_out_of_range_response()


@router.delete("/config/profiles/{index}")
async def delete_profile(request, index: int):
    try:
        return service.delete_profile(index)
    except service.IndexOutOfRange:
        return _index_out_of_range_response()


@router.patch("/config")
async def patch_config(request, body: RecentIndexBody):
    try:
        return service.set_recent_index(body.recent_profile_index)
    except service.IndexOutOfRange:
        return _index_out_of_range_response()

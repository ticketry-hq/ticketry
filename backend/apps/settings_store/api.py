import json
from datetime import datetime, timezone
from typing import Any, Optional

from django.http import JsonResponse
from ninja import Router
from pydantic import BaseModel, ConfigDict

from apps.settings_store import dao, service
from apps.settings_store.provider_catalog import (
    PROVIDER_CATALOG_KEY,
    PROVIDER_CATALOG_SCOPE,
    PROVIDER_ORDER,
    ProviderCatalog,
    parse_provider_catalog,
)


router = Router(tags=["system"])

KEYBINDINGS_SCOPE = "host"
KEYBINDINGS_KEY = "keybindings"


class SettingValueBody(BaseModel):
    value: Any


class ProviderCatalogBody(BaseModel):
    value: ProviderCatalog


class ProviderCatalogImpactBody(BaseModel):
    # How many per-state launch bindings this activation set blocks. Every
    # other workflow mutation shows its blast radius before committing; a
    # deactivation used to be the one that reported nothing.
    blocked_launch_bindings: int = 0


class ProviderCatalogSavedBody(ProviderCatalogImpactBody):
    value: ProviderCatalog


class ProfileBody(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str
    workspace_slug: str
    agent_prompt: Optional[str] = None
    agent_prompts: dict = {}
    module_folders: dict = {}
    recent_project_id: Optional[str] = None
    recent_module_ids: dict = {}


class FeaturesBody(BaseModel):
    projects: bool


class ConfigBody(BaseModel):
    recent_profile_index: Optional[int]
    profiles: list[ProfileBody]
    features: FeaturesBody


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
    # The same salvage the launch path reads through, so the panel can never
    # show a wider activation set than the gate will actually honour.
    catalog = (
        ProviderCatalog() if value is None else parse_provider_catalog(value)
    )
    return {"value": catalog.model_dump(mode="json")}


@router.post(
    "/settings/provider-catalog/impact", response=ProviderCatalogImpactBody
)
async def preview_provider_catalog_impact(request, body: ProviderCatalogBody):
    """Report what a candidate activation set would block, without saving it."""

    return {
        "blocked_launch_bindings": await _count_blocked_launch_bindings(body.value)
    }


@router.put("/settings/provider-catalog", response=ProviderCatalogSavedBody)
async def put_provider_catalog(request, body: ProviderCatalogBody):
    await dao.upsert_setting(
        scope=PROVIDER_CATALOG_SCOPE,
        key=PROVIDER_CATALOG_KEY,
        value=body.value.model_dump_json(),
        updated_at=datetime.now(timezone.utc).isoformat(),
    )
    return {
        "value": body.value.model_dump(mode="json"),
        "blocked_launch_bindings": await _count_blocked_launch_bindings(
            body.value
        ),
    }


async def _count_blocked_launch_bindings(catalog: ProviderCatalog) -> int:
    """Count launch bindings this activation set refuses at launch time."""

    from worktracker.models import LaunchBinding

    deactivated = [
        provider
        for provider in PROVIDER_ORDER
        if provider not in catalog.activated_providers
    ]
    if not deactivated:
        return 0
    return await LaunchBinding.objects.filter(agent__in=deactivated).acount()


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

"""Transport-independent settings application operations used by DRF."""

import json
from datetime import datetime, timezone
from typing import Any

from asgiref.sync import sync_to_async
from django.db import transaction
from pydantic import BaseModel

from apps.errors import ApplicationError
from apps.settings_store import dao
from apps.settings_store.provider_catalog import (
    PROVIDER_CATALOG_KEY,
    PROVIDER_CATALOG_SCOPE,
    ProviderCatalog,
    parse_provider_catalog,
    validate_global_launch_default,
)


KEYBINDINGS_SCOPE = "host"
KEYBINDINGS_KEY = "keybindings"


class ProviderCatalogWrite(ProviderCatalog):
    activated_providers: list[str]


class ProviderCatalogBody(BaseModel):
    value: ProviderCatalogWrite


CONFIGURABLE_PROVIDER_SLUGS = ("claude", "codex", "gemini")


async def get_keybindings():
    value = await dao.get_setting(KEYBINDINGS_SCOPE, KEYBINDINGS_KEY)
    if value is None:
        return {"value": None}
    try:
        return {"value": json.loads(value)}
    except json.JSONDecodeError:
        return {"value": None}


async def put_keybindings(value: Any):
    await dao.upsert_setting(
        scope=KEYBINDINGS_SCOPE,
        key=KEYBINDINGS_KEY,
        value=json.dumps(value),
        updated_at=datetime.now(timezone.utc).isoformat(),
    )
    return {"value": value}


async def get_provider_catalog():
    from worktracker.models import Provider

    value = await dao.get_setting(PROVIDER_CATALOG_SCOPE, PROVIDER_CATALOG_KEY)
    catalog = ProviderCatalog() if value is None else parse_provider_catalog(value)
    activated = await sync_to_async(list)(
        Provider.objects.filter(
            slug__in=CONFIGURABLE_PROVIDER_SLUGS,
            activated=True,
        ).values_list("slug", flat=True)
    )
    return {
        "value": {
            "activated_providers": [
                slug for slug in CONFIGURABLE_PROVIDER_SLUGS if slug in activated
            ],
            **catalog.model_dump(mode="json"),
        }
    }


def _put_provider_catalog_atomically(value: ProviderCatalogWrite) -> dict:
    from apps.settings_store.models import AppSetting
    from worktracker.models import Provider

    activated = set(value.activated_providers)
    unknown = activated.difference(CONFIGURABLE_PROVIDER_SLUGS)
    if unknown:
        raise ValueError(
            f"Provider '{sorted(unknown)[0]}' is not configurable in Settings."
        )

    validate_global_launch_default(value.global_default)
    persisted = ProviderCatalog(global_default=value.global_default)
    with transaction.atomic():
        for slug in CONFIGURABLE_PROVIDER_SLUGS:
            Provider.objects.filter(slug=slug).update(activated=slug in activated)
        AppSetting.objects.update_or_create(
            scope=PROVIDER_CATALOG_SCOPE,
            key=PROVIDER_CATALOG_KEY,
            defaults={
                "value": persisted.model_dump_json(),
                "updated_at": datetime.now(timezone.utc).isoformat(),
            },
        )
    return value.model_dump(mode="json")


async def put_provider_catalog(body: ProviderCatalogBody):
    try:
        value = await sync_to_async(_put_provider_catalog_atomically)(body.value)
    except ValueError as exc:
        raise ApplicationError(422, str(exc)) from exc
    return {"value": value}

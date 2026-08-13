"""Async persistence helpers for scoped application settings."""

from __future__ import annotations

from typing import Optional

from apps.settings_store.models import AppSetting


async def get_setting(scope: str, key: str) -> Optional[str]:
    """Return one stored setting value."""

    return await AppSetting.objects.filter(scope=scope, key=key).values_list(
        "value", flat=True
    ).afirst()


async def upsert_setting(
    *,
    scope: str,
    key: str,
    value: str,
    updated_at: str,
) -> None:
    """Insert or replace one scoped setting value."""

    from apps.settings_store.write_ownership import (
        assert_django_settings_write_allowed,
    )

    assert_django_settings_write_allowed()

    await AppSetting.objects.aupdate_or_create(
        scope=scope,
        key=key,
        defaults={"value": value, "updated_at": updated_at},
    )

"""Provider catalog reads and the adapter/table startup invariant."""

from collections.abc import Collection

from worktracker.models import Provider


class ProviderCatalogDrift(RuntimeError):
    """The persisted provider vocabulary and executable adapters disagree."""


def activated_provider_slugs() -> frozenset[str]:
    """Return the host-wide provider activation set from catalog rows."""

    return frozenset(
        Provider.objects.filter(activated=True).values_list("slug", flat=True)
    )


def provider_supports_unattended(slug: str) -> bool:
    """Read unattended capability from the persisted provider description."""

    return Provider.objects.filter(slug=slug, supports_unattended=True).exists()


def assert_provider_catalog_matches_adapters(
    adapter_slugs: Collection[str],
) -> None:
    """Fail startup on either side of provider catalog/adapter drift."""

    adapters = set(adapter_slugs)
    rows = set(Provider.objects.values_list("slug", flat=True))
    missing_rows = sorted(adapters - rows)
    missing_adapters = sorted(rows - adapters)
    if not missing_rows and not missing_adapters:
        return

    details = []
    if missing_rows:
        details.append(f"adapters without Provider rows: {', '.join(missing_rows)}")
    if missing_adapters:
        details.append(f"Provider rows without adapters: {', '.join(missing_adapters)}")
    raise ProviderCatalogDrift("Provider catalog drift: " + "; ".join(details))

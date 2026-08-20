# Module link DRF override

## Per-module upsert

- DRF-native capability attempted: `UpdateModelMixin` on a `GenericViewSet`,
  with the URL bound to the unique module foreign key and a ModelSerializer.
- Exact missing behavior: DRF's update mixin returns 404 when the row does not
  exist, while PUT here intentionally creates or replaces the module's one link.
- Why a frontend adapter over the generated SDK is insufficient: Upsert and
  last-write-wins are persistence semantics shared by every client.
- Why a serializer field / `validate` / `read_only_fields` is insufficient:
  The ModelSerializer is sufficient for the wire allowlist, but cannot change
  update's missing-row lookup behavior.
- Why `permission_classes` and `get_queryset` scoping are insufficient: Global
  authentication is sufficient; neither scoping mechanism can create a row.
- Why a database constraint/default is insufficient: The unique foreign key
  prevents duplicates but cannot make a missing update create the row.
- Why an existing service function is insufficient: The settings service owns
  the transactional upsert, but the ViewSet must let PUT reach that service
  when no row exists yet.
- Smallest custom seam: `get_object` supplies an unsaved ModelSerializer
  instance only for PUT; the standard update mixin validates and renders it,
  and `perform_update` replaces it with the service result.
- Service module / `transaction.atomic` used:
  `apps.settings_store.module_links.upsert_module_link`, locking the module row
  before `update_or_create`.
- Protected fields excluded from the request schema: `id`, `module_id`,
  `created_at`, and `updated_at` are read-only on the resource serializer; the
  operation's ModelSerializer request projection contains only `local_path`.
- Identity/scope binding (URL kwarg + queryset filter): `<uuid:module_id>` is
  bound to `ModuleLink.module_id`; the service independently requires that it
  identify a real `Issue(type="module")`.
- Contract-drift and regression test: HTTP tests cover list, create-by-PUT,
  replace-by-PUT, delete, validation, uniqueness, and cascade; contract
  generation fixes the operation IDs and request/response schemas.
- Registry entry, if this is genuinely non-CRUD: Not applicable; this is PUT
  replacement with create-on-missing semantics for a uniquely keyed resource.

# Module folder validation DRF override

## Stateless folder validation

- DRF-native capability attempted: a `GenericViewSet` action with named request
  and response serializers.
- Exact missing behavior: the operation validates a host path but owns no model
  row that a CRUD mixin could retrieve or mutate.
- Why a frontend adapter over the generated SDK is insufficient: only the
  backend process can inspect the sidecar host filesystem.
- Why a serializer field / `validate` / `read_only_fields` is insufficient:
  serializers own the wire shape, while path existence and directory checks
  are shared application behavior.
- Why `permission_classes` and `get_queryset` scoping are insufficient: default
  authentication applies, but there is no queryset.
- Why a database constraint/default is insufficient: validation is stateless
  and inspects the filesystem.
- Why an existing service function is insufficient: the existing validator
  owns the checks, but a DRF action is still needed to expose it over HTTP.
- Smallest custom seam: `SettingsDomainActionMixin.validate_folder` validates
  one `path`, calls the existing validator, and serializes its result.
- Service module / `transaction.atomic` used:
  `apps.settings_store.module_folder_validation.validate_module_folder`; no
  transaction is needed because the operation writes nothing.
- Protected fields excluded from the request schema: the request has only the
  caller-owned `path` field.
- Identity/scope binding (URL kwarg + queryset filter): not applicable to this
  stateless installation-scoped operation.
- Contract-drift and regression test: endpoint tests cover an existing
  directory, relative paths, missing paths, and regular files. Contract
  generation preserves `config_folders_validate_create`.
- Registry entry, if this is genuinely non-CRUD: `SettingsDomainActionMixin`
  is the settings-store quarantine entry for this stateless operation.

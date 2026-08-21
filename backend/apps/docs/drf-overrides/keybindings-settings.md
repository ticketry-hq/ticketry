# Keybindings settings DRF override

## Host keybindings retrieve and replace

- DRF-native capability attempted: A singleton `GenericViewSet` bound to the
  existing GET and PUT path, with a named DRF serializer for both request and
  response validation.
- Exact missing behavior: `AppSetting` persists a fixed `(scope, key)` row whose
  `value` column is a JSON string, while the HTTP resource intentionally exposes
  only `{ "value": <arbitrary JSON or null> }`. A model serializer would expose
  persistence fields and the encoded storage representation rather than the
  keybindings contract.
- Why a frontend adapter over the generated SDK is insufficient: The storage
  encoding and fixed host scope are server-owned persistence details shared by
  every caller; clients must not provide or decode them.
- Why a serializer field / `validate` / `read_only_fields` is insufficient: A
  named `JSONField` serializer is sufficient for the wire contract and is used.
  The only retained seam is the service-owned conversion between arbitrary JSON
  and the model's encoded string column.
- Why `permission_classes` and `get_queryset` scoping are insufficient: The
  installation-wide API-key authentication and `IsAuthenticated` permission
  remain sufficient. There is no caller-selected row identity to scope: the
  service fixes identity to `(host, keybindings)`.
- Why a database constraint/default is insufficient: Constraints can protect
  the composite setting identity but cannot translate arbitrary JSON to and
  from the encoded string representation or preserve the established behavior
  where malformed stored JSON reads as `null`.
- Why an existing service function is insufficient: The existing settings
  operation and DAO are sufficient and remain authoritative. The REST boundary
  still needs a named serializer and ViewSet to replace manual Pydantic parsing
  and response assembly.
- Smallest custom seam: `KeybindingsViewSet` overrides singleton retrieve and
  update methods, validates PUT through `SettingValueSerializer`, delegates
  fixed-scope persistence to `apps.settings_store.api`, and serializes the
  returned envelope with the same serializer.
- Service module / `transaction.atomic` used: `apps.settings_store.api` and
  `apps.settings_store.dao`; `aupdate_or_create` performs the single-row upsert,
  so no multi-row transaction is required.
- Protected fields excluded from the request schema: `scope`, `key`,
  `updated_at`, and the encoded database `value` string are absent. The request
  contains only the decoded JSON `value` property.
- Identity/scope binding (URL kwarg + queryset filter): The singleton has no URL
  identity. The service binds every operation to the constants `host` and
  `keybindings`; the client cannot select another setting row.
- Contract-drift and regression test: Existing keybindings endpoint tests cover
  PUT/GET round trips, fixed persistence identity, missing values, and malformed
  stored JSON. The generated contract check protects the existing paths,
  operation IDs, and `SettingValue` wire schema.
- Registry entry, if this is genuinely non-CRUD: Not applicable. GET and PUT
  retain ordinary retrieve/replace semantics for one singleton keybindings
  resource; they do not introduce a domain command.

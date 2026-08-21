# Module presentation visibility DRF override

## Module presentation visibility

- DRF-native capability attempted: `UpdateModelMixin` with a one-field `ModelSerializer` request and a model-backed detail route.
- Exact missing behavior: the write must create a presentation row when none exists, preserve an existing canonical rank, and return the full presentation record after accepting only `tab_hidden`.
- Why a frontend adapter over the generated SDK is insufficient: every client needs the same visible-by-default and rank-preservation semantics.
- Why a serializer field / `validate` / `read_only_fields` is insufficient: those controls cannot lock the module or create the missing presentation row without changing the native update response to the one-field request shape.
- Why `permission_classes` and `get_queryset` scoping are insufficient: row scoping cannot update a presentation row that does not exist yet.
- Why a database constraint/default is insufficient: the default covers new rows but does not validate that the URL identifies a live module or preserve rank under concurrent writes.
- Why an existing service function is insufficient: `set_module_tab_hidden` owns persistence, but `UpdateModelMixin` serializes its response with the request serializer.
- Smallest custom seam: `ModulePresentationWriteSerializer.to_representation` delegates the saved instance to `ModulePresentationSerializer`; the ViewSet otherwise uses native `UpdateModelMixin` behavior.
- Service module / `transaction.atomic` used: `worktracker.services.module_visibility.set_module_tab_hidden` locks the module and upserts only `tab_hidden`.
- Protected fields excluded from the request schema: the generated `ModulePresentationWrite` body contains only `tab_hidden`; module identity comes from the URL and rank is server-owned.
- Identity/scope binding (URL kwarg + queryset filter): `module_id` is the detail lookup; the service accepts only a live work item whose type is `module`.
- Contract-drift and regression test: `npm run contract:check`; `test_module_visibility_api.py` covers missing records, round trips, rank preservation, deleted and unknown modules, and schema exposure.
- Registry entry, if this is genuinely non-CRUD: none; this is the model resource's ordinary `PUT` update route in `MODEL_ROUTES`.

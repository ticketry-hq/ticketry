# Work-item and attachment DRF overrides

## Work-item create and partial update

- DRF-native capability attempted: `CreateModelMixin` and `UpdateModelMixin` with model-derived request serializers.
- Exact missing behavior: both operations delegate writes to invariant-owning services and return the complete read representation rather than their narrower request representation; detail identity also accepts either a UUID or computed project key, which cannot be expressed by one model lookup field.
- Why a frontend adapter over the generated SDK is insufficient: workflow birth, review-finding creation, hierarchy propagation, blocker-cycle checks, and state transitions must be enforced for every writer.
- Why a serializer field / `validate` / `read_only_fields` is insufficient: those mechanisms validate transport fields but cannot replace the shared transactional service operations.
- Why `permission_classes` and `get_queryset` scoping are insufficient: row access does not enforce cross-row workflow, tree, and blocker invariants.
- Why a database constraint/default is insufficient: several rules require graph traversal, workflow publication checks, or coordinated multi-row changes.
- Why an existing service function is insufficient: the services return an `Issue`, but the stock mixins serialize the narrower request serializer after `perform_create` or `perform_update`.
- Smallest custom seam: custom `create` and `partial_update` methods retain the standard serializer validation sequence, delegate exactly once through `perform_*`, and serialize the service-returned row with `WorkItemSerializer`; `get_object` delegates only the established dual-identifier lookup to `retrieve_work_item`.
- Service module / `transaction.atomic` used: `worktracker.services.work_items.create_work_item` and `update_work_item`.
- Protected fields excluded from the request schema: ids, project, sequence, rank, archive state, revisions, timestamps, and derived relations are absent from the explicit `ModelSerializer` request allowlists.
- Identity/scope binding (URL kwarg + queryset filter): create binds `project_id`; update binds `issue_id`, whose established contract accepts either UUID or project key through `retrieve_work_item`.
- Contract-drift and regression test: `npm run contract:check`; unchanged `test_work_items_api.py` covers validation, response shape, hierarchy, blockers, and structured workflow errors.
- Registry entry, if this is genuinely non-CRUD: not applicable; these remain model create and update operations.

## Work-item exact-id batch read

- DRF-native capability attempted: `ListModelMixin` with query parameters.
- Exact missing behavior: the established operation accepts up to one hundred UUIDs in a POST body, de-duplicates them, omits missing rows, and preserves caller order.
- Why a frontend adapter over the generated SDK is insufficient: replacing one bounded request with one hundred detail requests changes latency and consistency characteristics.
- Why a serializer field / `validate` / `read_only_fields` is insufficient: `WorkItemBatchSerializer` validates the bounded body but cannot express caller-ordered queryset results through a stock list action.
- Why `permission_classes` and `get_queryset` scoping are insufficient: queryset ordering cannot preserve arbitrary caller order after de-duplication without database-specific expression construction.
- Why a database constraint/default is insufficient: this is a read transport contract, not persisted state.
- Why an existing service function is insufficient: `batch_work_items` owns ordering and omission semantics, while the HTTP action still must validate and serialize the request and response.
- Smallest custom seam: the owning `WorkItemViewSet` inherits a `batch` action quarantined in `domain_ops.py`; it validates one named serializer, delegates once, and serializes with `WorkItemSerializer(many=True)`.
- Service module / `transaction.atomic` used: `worktracker.services.work_items.batch_work_items`; read-only, so no transaction is required.
- Protected fields excluded from the request schema: the body contains only `ids`, bounded to 1–100 UUID values.
- Identity/scope binding (URL kwarg + queryset filter): exact IDs are the requested scope; only task rows are returned by the service's `task_qs()` filter.
- Contract-drift and regression test: `npm run contract:check`; unchanged batch tests verify validation, de-duplication, omission, and order.
- Registry entry, if this is genuinely non-CRUD: `WorkItemDomainActionMixin.batch` in `backend/worktracker/rest/domain_ops.py`, because body-based bounded lookup is RPC-shaped.

## Attachment multipart create

- DRF-native capability attempted: `CreateModelMixin` with `AttachmentUploadSerializer`, `MultiPartParser`, and `FormParser`.
- Exact missing behavior: the upload request exposes `file` plus the caller-facing alias `name`, while the response is the read-only attachment representation including derived URL and stored metadata.
- Why a frontend adapter over the generated SDK is insufficient: MIME type, byte size, fallback filename, and owning issue are server-derived from the uploaded file.
- Why a serializer field / `validate` / `read_only_fields` is insufficient: the named `ModelSerializer` handles validation, but the stock create response would expose only the upload fields.
- Why `permission_classes` and `get_queryset` scoping are insufficient: access scoping does not derive or persist upload metadata.
- Why a database constraint/default is insufficient: file metadata and storage URL are available only during upload handling.
- Why an existing service function is insufficient: `create_attachment` returns the saved row, but the stock mixin uses the request serializer for its response.
- Smallest custom seam: custom `create` retains generic validation and `perform_create`, then serializes the service-returned attachment with `AttachmentSerializer`. The multipart schema remains explicitly binary because drf-spectacular otherwise renders the model `FileField` as a response URI when request/response components are not globally split.
- Service module / `transaction.atomic` used: `worktracker.services.attachments.create_attachment`; the operation performs one model create and storage write.
- Protected fields excluded from the request schema: issue, id, filename metadata, MIME type, size, URL, and timestamp remain server-owned; the request exposes only `file` and optional `name`.
- Identity/scope binding (URL kwarg + queryset filter): `issue_id` is bound by the nested URL and resolved by the attachment service before the write.
- Contract-drift and regression test: `npm run contract:check`; unchanged attachment and SDK tests cover required binary input, disk persistence, metadata, nested listing, and URL shape.
- Registry entry, if this is genuinely non-CRUD: not applicable; this remains model create on a nested collection.

# Document operation DRF override records

## Document listing with registry reconciliation

- DRF-native capability attempted: `GenericViewSet.list` with a named query serializer and a model-derived response serializer.
- Exact missing behavior: the collection is assembled only after reconciling registered rows with files and durable run boundaries, including pruning missing files and discovering new files.
- Why a frontend adapter over the generated SDK is insufficient: reconciliation mutates the server-owned registry and must happen before the response is serialized.
- Why a serializer field / `validate` / `read_only_fields` is insufficient: serializers validate the query and expose only `id`, `rel_path`, and derived `label`; they cannot perform asynchronous filesystem and registry reconciliation.
- Why `permission_classes` and `get_queryset` scoping are insufficient: authentication remains framework-owned, but the collection is not representable as one ORM queryset until reconciliation completes.
- Why a database constraint/default is insufficient: the source of truth includes files created while no watcher was running.
- Why an existing service function is insufficient: the existing document API and service functions are used; the custom seam only invokes them from `list`.
- Smallest custom seam: a serializer-backed `DocumentViewSet.list` override.
- Service module / `transaction.atomic` used: `apps.documents.api.list_documents` delegates to `apps.documents.service`; DAO operations retain their existing transaction boundaries.
- Protected fields excluded from the request schema: the `DocumentSerializer` is read-only and exposes no registry paths, ownership fields, timestamps, or discovery identity.
- Identity/scope binding (URL kwarg + queryset filter): task or scratch-module scope is validated from the query and resolved by the service/DAO; there is no detail-row mutation.
- Contract-drift and regression test: `apps/documents/tests/test_docs.py` covers task and scratch scope, rescan, pruning, authentication, and response fields; `npm run contract:check` seals the schema.
- Registry entry, if this is genuinely non-CRUD: not applicable; this is the resource collection's list operation.

## Digest-guarded primary document update

- DRF-native capability attempted: `GenericViewSet.update` with a named request serializer and declared success/conflict response serializers.
- Exact missing behavior: the target is a registered filesystem document rather than an ORM field update, and the write requires atomic digest comparison plus an `ETag` header on both success and conflict.
- Why a frontend adapter over the generated SDK is insufficient: the server must enforce compare-and-swap atomically against current file bytes.
- Why a serializer field / `validate` / `read_only_fields` is insufficient: DRF validates `content` and `digest`, but containment, Markdown-only targeting, digest comparison, and atomic replacement require the document service.
- Why `permission_classes` and `get_queryset` scoping are insufficient: default API-key authentication applies; registry-backed containment determines the only writable target.
- Why a database constraint/default is insufficient: the mutated resource is a file and its digest is computed from current bytes.
- Why an existing service function is insufficient: the existing service is retained; the custom seam maps its saved/conflict result to status, serialized body, and ETag.
- Smallest custom seam: a serializer-backed `DocumentViewSet.update` override.
- Service module / `transaction.atomic` used: `apps.documents.service.save_primary_markdown` uses digest-guarded `atomic_write_bytes`; no multi-row database transaction is involved.
- Protected fields excluded from the request schema: only `content` and `digest` are writable; registry identity and filesystem paths come exclusively from the URL and server registry.
- Identity/scope binding (URL kwarg + queryset filter): `doc_id` is bound from `/docs/{doc_id}` and resolved through the registered-document DAO before containment checks.
- Contract-drift and regression test: `apps/documents/tests/test_docs.py` covers auth, stale digest, ETag, traversal, symlink escape, unknown ids, non-Markdown documents, and asset write rejection; `npm run contract:check` seals the schema.
- Registry entry, if this is genuinely non-CRUD: not applicable; this is the registered document resource's update operation.

## Filesystem directory completion

- DRF-native capability attempted: a serializer-backed `@action` on the owning `DocumentViewSet`.
- Exact missing behavior: directory completion is a read-only host filesystem operation, not model CRUD.
- Why a frontend adapter over the generated SDK is insufficient: the webview cannot safely enumerate the sidecar host's filesystem.
- Why a serializer field / `validate` / `read_only_fields` is insufficient: the serializer validates the optional path and response entries; enumeration remains service behavior.
- Why `permission_classes` and `get_queryset` scoping are insufficient: default API-key authentication applies, but no database queryset exists for host directories.
- Why a database constraint/default is insufficient: the operation reads current filesystem state without persistence.
- Why an existing service function is insufficient: the existing completion service is retained; the custom seam only binds it to a declared DRF action.
- Smallest custom seam: `DocumentDomainActionMixin.complete`.
- Service module / `transaction.atomic` used: `apps.documents.service.complete_directories`; no persistence or transaction is involved.
- Protected fields excluded from the request schema: the request accepts only `path` and the response returns only matching directory paths.
- Identity/scope binding (URL kwarg + queryset filter): not applicable to a non-persisted host operation; installation-wide API-key authentication scopes access.
- Contract-drift and regression test: `apps/documents/tests/test_fs_complete.py` covers prefix, hidden, missing, and tilde cases plus authentication; `npm run contract:check` seals the schema.
- Registry entry, if this is genuinely non-CRUD: `DocumentDomainActionMixin.complete` in `apps/documents/domain_ops.py`.

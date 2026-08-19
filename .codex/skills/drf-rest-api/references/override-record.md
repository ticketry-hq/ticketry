# DRF override record

Complete this before adding or retaining custom REST code — a new `@action`,
a non-`ModelSerializer` payload, a diverging `extend_schema` override, or any
by-hand request/response handling.

```markdown
## <Resource / operation>

- DRF-native capability attempted:
- Exact missing behavior:
- Why a frontend adapter over the generated SDK is insufficient:
- Why a serializer field / `validate` / `read_only_fields` is insufficient:
- Why `permission_classes` and `get_queryset` scoping are insufficient:
- Why a database constraint/default is insufficient:
- Why an existing service function is insufficient:
- Smallest custom seam:
- Service module / `transaction.atomic` used:
- Protected fields excluded from the request schema:
- Identity/scope binding (URL kwarg + queryset filter):
- Contract-drift and regression test:
- Registry entry, if this is genuinely non-CRUD:
```

An incomplete record means the override is not ready to implement.

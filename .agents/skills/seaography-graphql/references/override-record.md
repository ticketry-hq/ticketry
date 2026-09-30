# Seaography override record

Complete this before adding or retaining custom database-backed GraphQL code.

```markdown
## <Model / operation>

- Generated capability attempted:
- Exact missing behavior:
- Why `.graphql` selection/alias/adapter is insufficient:
- Why `ColumnOptions`, skips, guards, or `entity_filter` are insufficient:
- Why a database constraint/default and SeaORM lifecycle hooks are insufficient:
- Create-one safety:
- Create-batch safety:
- Update safety:
- Delete safety:
- Smallest custom seam:
- SeaORM transaction/domain module used:
- Protected fields excluded:
- Identity/scope binding:
- Drift/regression test:
- Registry entry, if this is genuinely non-CRUD:
```

An incomplete record means the override is not ready to implement.

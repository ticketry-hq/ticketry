# Compose GraphQL mutations as resource-owned views

## Status

Accepted.

## Decision

Place each migrated GraphQL mutation under the resource that owns its model:

```text
<bounded_context>/<resource>/
  views/
    mod.rs
    <field>/
      mod.rs
      serializer.rs
  serializers/
    mod.rs
    <shared_rule>.rs
```

The field module calls the Seaolim registrar and owns the
`ViewSerializers` table passed to it. It may return that table from a local
`bindings()` function or construct `ViewSerializers::default()` at the call.
An empty table selects the plain write path. A view never reads another
view's bindings.

`views/mod.rs` only composes its child views. It does not register a mutation
itself. Put a serializer in the resource's `serializers/` directory only when
two or more views share the same rules.

Generated reads and relations remain in the resource's Seaography entity
registration. Authored queries and subscriptions do not receive serializer
tables. Mutation fields that still need an authored aggregate transaction use
the same nested layout, but remain recorded exceptions until Seaolim can
preserve their transaction and result contracts.

## Enforcement

`tests/graphql_view_registration_contract.rs` parses the Rust source tree. It
rejects Seaolim registrar calls outside `views/<field>/mod.rs` and calls that
omit the registrar's explicit `ViewSerializers` argument. The test covers
generated, hooked, restricted one-row, restricted set, and action registrars.

This decision changes registration placement only. A migration must keep the
published GraphQL field, arguments, nullability, result, errors, and transaction
behavior unless its own approved specification says otherwise.

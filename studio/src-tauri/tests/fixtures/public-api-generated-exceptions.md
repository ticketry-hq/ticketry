# Generated namespace exception records

`public-api-generated-exceptions.json` records the 40 already reviewed entity
namespace names in `public-api.txt`. Each record names one exact root namespace
and inventories its 16 supported SeaORM outputs with kind and gating evidence.
No private grouping ancestor appears in those reachable paths.

The framework requirement, rejected flat alternatives, smallest namespace,
protecting test, and compiler probe are recorded per namespace. The supported
macro shape is the canonical SeaORM `Model` with `DeriveEntityModel` and
`#[sea_orm::model]` without options. Changes to that supported expansion require
review of the exact macro output inventory and compiler probe.

The strengthened workspace guard validates these exact namespaces and all
reachable descendants. Approval refreshes require the shipping compiler probe
before updating root names and kind/gating evidence. The compiler probe is `public_api_generated_compile::retained_generated_namespaces_compile_with_relations_and_seaography`
through the shipping `Cargo.toml`. Source audits alone are not compilation proof.

Authored helper exposure still fails even if somebody adds its path to this
record. Receipt persistence now lives in a private sibling and is available only
as the explicit root leaves `append_ship_receipt`, `AppendReceipt`, and
`ReceiptError`. The six sprint lifecycle constants live in a private sibling
and have explicit `SPRINT_*` and `SPRINT_SUGGESTION_*` root names. Generated
entity models, relations, before-save validation, and receipt transaction
ownership are unchanged; these authored leaves are outside every exceptional
namespace.

Test-support namespaces cannot receive generated exceptions. The checker
conservatively rejects the exact `feature = "test-support"` predicate anywhere
in root or descendant gating evidence, including nested or negated conditions
and cfg_attr evidence. Features with other names remain ordinary conditional
evidence. Refreshing an exception inventory cannot bypass this policy.

`policy::write_approval_files` first validates structure and exact reachable
descendants, then executes the recorded compiler probes, then writes the root
name and kind/gating files. A stale, wildcard, whole-crate, authored-helper, or
unproven exception cannot be made valid by refreshing inventories.

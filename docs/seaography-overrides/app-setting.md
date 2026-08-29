## AppSetting keybinding update

- Generated capability attempted: generated create-one, create-batch, update, and delete for `app_settings`.
- Exact missing behavior: the public write is an upsert for exactly `scope = "host"` and `key = "keybindings"`. The caller may supply only a JSON value. Ticketry derives the composite identity and timestamp.
- Why `.graphql` selection/alias/adapter is insufficient: a client operation cannot remove generated identity fields or make the generated update filter bind one required row.
- Why `ColumnOptions`, skips, guards, or `entity_filter` are insufficient: skips can hide protected columns, but generated update still accepts an optional filter and can affect several rows. The write also materializes the fixed row when it does not exist.
- Why a database constraint/default and SeaORM lifecycle hooks are insufficient: the composite primary key prevents duplicate identities, but it cannot choose the one public identity, restrict the caller to the JSON value, or provide update-or-insert behavior through one generated mutation.
- Create-one safety: private. Generated create would let callers choose the setting identity and timestamp.
- Create-batch safety: private for the same reason and because keybinding settings are one fixed row.
- Update safety: private. Generated update exposes an optional many-row filter and does not materialize a missing fixed row.
- Delete safety: private. Keybinding settings have no public delete contract.
- Smallest custom seam: `update_keybinding_setting(value)` is a restricted model-shaped upsert returning the authoritative `AppSetting` row as `KeybindingSetting`.
- SeaORM transaction/domain module used: `RestrictedModelMutation::prepare` reads the fixed composite identity in Seaolim's transaction and prepares one `ActiveModel` insert or update. Seaolim owns persistence and commit.
- Protected fields excluded: `scope`, `key`, and `updated_at` are absent from the public mutation arguments. No generated `AppSetting` mutation is registered.
- Identity/scope binding: the view always binds `host/keybindings`; callers cannot submit or filter identity.
- Drift/regression test: the keybinding GraphQL tests assert the exact mutation SDL, absence of generated setting writes, fixed identity, JSON round-trip, unrelated-row preservation, restart readback, and typed storage failures.
- Registry entry, if this is genuinely non-CRUD: none. This remains a model-shaped update.

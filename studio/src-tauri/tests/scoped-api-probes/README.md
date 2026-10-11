# External scoped facade compiler probes

Run from the repository root:

```sh
cargo test --locked --offline --manifest-path studio/src-tauri/tests/scoped-api-probes/Cargo.toml --test public_api_external_compile
```

The same test also belongs to the shipping workspace:

```sh
cargo test --locked --manifest-path studio/src-tauri/Cargo.toml --test public_api_external_compile
```

The standalone runner avoids building the desktop shell when inspecting the
scoped facade boundary. It does not substitute for shipping workspace checks.

The test creates two temporary Cargo workspaces with ordinary dependencies on
the real work-management and workspace-runtime crates and resolver 2. One
explicitly enables work-management's non-default `test-support` feature; the
other does not. Their locks start from the shipping lock and Cargo resolves
each external graph offline, so run the shipping dependency fetch first if the
local Cargo cache is empty. Shipping dev dependencies are outside these graphs.

Each graph must compile normal root imports successfully before a negative
probe runs. Cargo's compiler-artifact messages identify the exact facade
metadata and confirm whether `test-support` is active. The graphs reuse the
shipping target cache, but cached artifacts do not unify their features: each
rustc probe receives the exact metadata path emitted for its graph.

All approved scoped root names from `fixtures/public-api.txt` must compile,
with fixture names omitted only in the disabled graph. Former namespace paths
and the whole-entity alias must fail with `E0603` or `E0432`, identify the
expected rejected item, and point at the external probe source. Each fixture
import is checked independently when enabled and disabled; the enabled checks
require the fixed fixture names even if an approval entry is removed. Other compiler errors, including
errors without a diagnostic code, fail the test rather than count as privacy
evidence. Only rustc's final abort summary is excluded from those assertions.

The existing private implementation move fixture separately proves that a
consumer stays unchanged while the implementation moves:

```sh
cargo test --locked --offline --manifest-path studio/src-tauri/tests/public-api-fixtures/Cargo.toml --test public_api_fixture_contract compile_fixtures::moving_private_implementation_preserves_the_audited_external_consumer -- --exact
```

Temporary consumer sources and locks are removed on completion. The standalone
runner's `target/` is ignored; its checked-in lock keeps runner dependencies
repeatable.

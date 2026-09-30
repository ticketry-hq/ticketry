# CODING-1393 native-view retention measurement

The warm retention limit needs packaged-build evidence. Development builds and
browser-only runs are not valid for this decision.

## What the sampler measures

`studio/scripts/native-view-resource-measurement.mjs` samples the packaged
Ticketry process with macOS `ps`. It deliberately excludes spawned tmux,
provider, and agent processes because their resource use is not caused by an
AppKit view. Each capture records CPU, resident memory, executable SHA-256,
hardware, macOS version, and the declared native-view state. The report accepts
only a matching set with 1,
5, and 20 retained native views.

The executable hash prevents captures from different builds being combined.
The workload and view-state checks prevent a hidden-idle capture from being
compared with a selected terminal producing output.

## Automated packaged protocol

The benchmark command is compiled only with `desktop-acceptance`, requires the
explicit `TICKETRY_NATIVE_RETENTION_BENCHMARK=1` runtime gate, and refuses to
run if a product native-view attachment exists. It creates real libghostty
surfaces backed by idle `/bin/cat` processes. Native code verifies the requested
count, one visible and selected surface, and `count - 1` hidden surfaces before
the sampler starts.

1. Build an unsigned packaged app with native libghostty and the acceptance
   driver.

   ```bash
   cd studio
   npm exec tauri build -- --bundles app \
     --features native-libghostty,desktop-acceptance \
     --target aarch64-apple-darwin \
     --config '{"bundle":{"macOS":{"hardenedRuntime":false,"entitlements":null}}}'
   ```

2. Use the budget committed with the measurement script before the first valid
   capture: relative to the one-view baseline, hidden retained views may add at
   most 1 percentage point of idle CPU and 1% of the machine's physical RAM.
   The CPU bound follows the lifecycle rule that hidden views stop drawing.
   The memory bound caps this optional warm cache at a fixed share of the test
   machine instead of baking in a machine-specific MiB guess.

3. Run the packaged benchmark. It launches 1, 5, and 20 in separate disposable
   profiles and processes, keeps WebDriver alive during a 120-second settling
   period, then records 60 one-second samples. It disposes every native surface
   and process between counts.

   ```bash
   npm run measure:native-ghostty-retention:packaged -- \
     --app src-tauri/target/aarch64-apple-darwin/release/bundle/macos/Ticketry.app \
     --output-dir /tmp/coding-1393-native-retention-final
   ```

The selected limit is the largest measured candidate inside both budgets. For
example, if 1 and 5 views pass and 20 fails, the measured limit is 5. A limit
such as 8 or 10 would be a guess because this protocol did not measure it.

## Required evidence

## Measured result

Captured on 2026-09-04 with packaged executable SHA-256
`d91529d2c05647d32228b21611cadd6bd33ab4478f936e5afa28396a4e5d9c60`.
The machine was an Apple M2 Pro `Mac14,9` with 16 GiB RAM, arm64, running macOS
26.2.

| Total mounted views | Hidden views | CPU p95 | CPU over baseline | RSS p95 | RSS over baseline |
| ---: | ---: | ---: | ---: | ---: | ---: |
| 1 | 0 | 0.7% | 0 pp | 134.86 MiB | 0 MiB |
| 5 | 4 | 1.5% | 0.8 pp | 143.64 MiB | 8.78 MiB |
| 20 | 19 | 1.1% | 0.4 pp | 168.42 MiB | 33.56 MiB |

All measured counts fit the predeclared budgets. The selected warm retention
limit is **20 total mounted native views**, including the selected view. This is
the largest measured candidate; the implementation must evict the least
recently used inactive view before mounting a twenty-first.

Trial captures with a 30-second settle were discarded. Process initialization
released hundreds of MiB and caused a short CPU burst as late as 72 seconds
after native provisioning, which contaminated the comparison. The final
captures use the 120-second settling window documented above. Raw JSON captures
and the generated report are attached to CODING-1393 and remain outside git.

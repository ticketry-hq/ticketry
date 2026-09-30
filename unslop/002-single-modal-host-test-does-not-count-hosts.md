# Single-host test only checks for one matching string

Tag: `delete`. Confidence: high.

Location: `studio/src/test/singleModalHost.test.ts:10-18`.

The test claims to enforce one global ModalHost, but its helper returns a boolean for a regex match in `main.tsx`. Adding a second `<ModalHost />` there still passes. A host elsewhere is invisible to it. Even a commented-out host satisfies the assertion.

Delete this 18-line test after moving its intended assertion into an entry composition test. Mount the real entry composition with a counted host substitute and assert exactly one host. Keep existing modal interaction tests, which cover different behavior.

Validation: a temporary duplicate host must fail the replacement case, including a duplicate nested in the app composition.

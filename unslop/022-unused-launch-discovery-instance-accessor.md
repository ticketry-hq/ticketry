# Launch discovery exports an unread renderer-instance accessor

Tag: `delete`. Confidence: high for checked-in callers.

Location: `studio/src/features/agents/status/launchDiscoveryTrace.ts:104-106`.

launchDiscoveryRendererInstance returns the module's rendererInstance value. Whole-repository search finds no caller, test, or re-export.

Delete the accessor. Keep rendererInstance itself, which the recorder uses to attribute events. This removes a spare API without changing trace records.

Validation: frontend typecheck and a repeated symbol search. No new test is needed.

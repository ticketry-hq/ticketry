# Review workbench reconstructs identities from display labels

Tag: `shrink`. Confidence: high.

Location: `review-workbench/app.js:69-86`.

emptyCells builds strings containing a type name, a middle-dot separator, and a state name. activeEmptyCells then splits those strings back into identities to check workflow membership. The review renderer also calls both functions, repeating the full empty-cell scan.

Filter by workflow membership while typeName and state.name are still available in the loop, then format the label. A small `activeOnly = false` argument on emptyCells can serve the two existing requests without parsing presentation text. Alternatively return identity objects and format them at rendering time if other callers need the fields.

Prefer the first option for the current callers. Delete activeEmptyCells and replace its calls with the filtered empty-cell request.

Validation: review-workbench tests should exercise inactive empty cells and active empty cells. The displayed summary and finalize decision must remain the same.

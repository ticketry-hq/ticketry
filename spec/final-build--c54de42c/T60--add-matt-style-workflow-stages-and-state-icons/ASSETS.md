# CODING-60 workflow-stage icon assets

The transparent PNGs in [`assets/`](assets/) were generated for the five-stage
Matt-style workflow described in CODING-60. They are design inputs for the
refinement and implementation sessions; they are not wired into Studio yet.

## Files

| Stage | Asset | Reference motif |
| --- | --- | --- |
| Grill | [`assets/grill.png`](assets/grill.png) | White flame in a red ring |
| Spec | [`assets/spec.png`](assets/spec.png) | White checklist clipboard in a yellow ring |
| Tickets | [`assets/tickets.png`](assets/tickets.png) | White ticket stub in a purple ring |
| Implement | [`assets/implement.png`](assets/implement.png) | White wrench in a green ring |
| Review | [`assets/review.png`](assets/review.png) | White code-search magnifier in a blue ring |

Each file is a 1254×1254 RGBA PNG with transparent corners and generous padding.
Keep the source resolution for future resizing; the eventual UI should render
the asset at the workflow-state header's icon size.

## Generation provenance

- Mode: built-in ImageGen.
- Reference: the workflow screenshot supplied on CODING-60, used as a style
  reference rather than an edit target.
- Transparency: generated on a flat chroma-key background, then removed locally
  with the ImageGen skill's `remove_chroma_key.py` helper using a soft matte and
  despill.
- Validation: all five outputs are RGBA, have fully transparent corners, and
  were visually checked on a dark background.

## Prompt set

Shared prompt:

> Create one high-resolution desktop workflow-state UI icon based on the supplied
> reference. Preserve its friendly hand-drawn marker/chalk character with bold,
> smooth antialiased strokes. Center one white glyph inside a slightly imperfect
> colored circular outline on a square canvas with generous even padding. Keep it
> minimal and legible at 16–24 px. Icon only: no label, words, other stages,
> shadows, background scene, 3D treatment, extra decoration, or watermark.

Stage variants:

- Grill: white hand-drawn flame; red ring near `#EF3B3B`.
- Spec: white hand-drawn checklist clipboard; yellow ring near `#F6C338`.
- Tickets: white hand-drawn ticket stub with inward notches and a short dashed
  center line; purple ring near `#A83BC7`.
- Implement: white hand-drawn open-end wrench on a gentle diagonal; green ring
  near `#46C66B`.
- Review: white hand-drawn magnifying glass containing code angle brackets; blue
  ring near `#42A8E8`.

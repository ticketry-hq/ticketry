/**
 * Where a pointer sits relative to the drop targets laid out along one axis.
 *
 * Placement is a one-dimensional question: a horizontal strip of tabs is
 * ordered left-to-right and a vertical list is ordered top-to-bottom, so only
 * the coordinate along that axis can say where a dragged item would land. The
 * cross-axis coordinate is deliberately ignored — drifting above or below a
 * tab strip (or beside a sidebar row) never changes which seam the gesture is
 * pointing at.
 */

export type DragAxis = "vertical" | "horizontal";
export type DropIntent = "near" | "far";

/** A target's occupancy along the drag axis, in client coordinates. */
export interface AxisSpan {
  readonly start: number;
  readonly end: number;
}

export interface AxisPlacement<TargetId extends string> {
  readonly targetId: TargetId;
  readonly intent: DropIntent;
}

interface AxisPoint {
  readonly clientX: number;
  readonly clientY: number;
}

interface AxisRect {
  readonly top: number;
  readonly left: number;
  readonly width: number;
  readonly height: number;
}

export function pointerAlongAxis(axis: DragAxis, point: AxisPoint): number {
  return axis === "vertical" ? point.clientY : point.clientX;
}

export function spanAlongAxis(axis: DragAxis, rect: AxisRect): AxisSpan {
  const start = axis === "vertical" ? rect.top : rect.left;
  const length = axis === "vertical" ? rect.height : rect.width;
  return { start, end: start + length };
}

/** The half of the span the pointer is in: `near` is the leading edge. */
export function intentWithinSpan(span: AxisSpan, pointer: number): DropIntent {
  return pointer < (span.start + span.end) / 2 ? "near" : "far";
}

/**
 * The target whose axis span contains the pointer, and the edge it resolves to.
 *
 * Containment is required rather than nearest-match: a pointer past both ends
 * of every target is genuinely away from the surface, and a gesture released
 * there must still be able to mean "cancel".
 */
export function resolvePlacementAlongAxis<TargetId extends string>(
  axis: DragAxis,
  point: AxisPoint,
  elements: ReadonlyMap<TargetId, HTMLElement>,
): AxisPlacement<TargetId> | null {
  const pointer = pointerAlongAxis(axis, point);
  for (const [targetId, element] of elements) {
    const span = spanAlongAxis(axis, element.getBoundingClientRect());
    // A target with no extent has not been laid out; it cannot own a seam.
    if (span.end <= span.start) continue;
    if (pointer < span.start || pointer > span.end) continue;
    return { targetId, intent: intentWithinSpan(span, pointer) };
  }
  return null;
}

import type { Element, Point } from "./types.js";

export type Bounds = { left: number; top: number; right: number; bottom: number };

// Fraction of each dimension available to the centered rectangular label area.
export function labelAreaFactor(type: string) {
  return type === "diamond" ? 0.5 : type === "ellipse" ? Math.SQRT1_2 : 1;
}

export function boundsOf(points: Iterable<Point>): Bounds {
  let left = Infinity,
    top = Infinity,
    right = -Infinity,
    bottom = -Infinity;
  for (const [x, y] of points) {
    left = Math.min(left, x);
    right = Math.max(right, x);
    top = Math.min(top, y);
    bottom = Math.max(bottom, y);
  }
  return { left, top, right, bottom };
}

export function extents(boxes: Iterable<Bounds>) {
  function* corners(): Generator<Point> {
    for (const box of boxes) {
      yield [box.left, box.top];
      yield [box.right, box.bottom];
    }
  }
  return boundsOf(corners());
}

export function localBounds(element: Element) {
  return element.points?.length
    ? boundsOf(element.points)
    : { left: 0, top: 0, right: element.width, bottom: element.height };
}

export function rotate([x, y]: Point, cx: number, cy: number, angle: number): Point {
  const cos = Math.cos(angle),
    sin = Math.sin(angle);
  return [cx + (x - cx) * cos - (y - cy) * sin, cy + (x - cx) * sin + (y - cy) * cos];
}

export function elementBounds(element: Element): Bounds {
  const { left, right, top, bottom } = localBounds(element);
  const cx = (left + right) / 2,
    cy = (top + bottom) / 2;
  const corners: Point[] = [
    [left, top],
    [right, top],
    [right, bottom],
    [left, bottom],
  ];
  const bounds = boundsOf(
    (element.points?.length ? element.points : corners).map((p) => rotate(p, cx, cy, element.angle ?? 0)),
  );
  return {
    left: element.x + bounds.left,
    right: element.x + bounds.right,
    top: element.y + bounds.top,
    bottom: element.y + bounds.bottom,
  };
}

// Excalidraw anchors an arrow label to the middle vertex or the middle segment.
export function arrowCenter(element: Element): Point {
  const points = element.points!;
  const middle = (points.length - 1) / 2;
  const [ax, ay] = points[Math.floor(middle)],
    [bx, by] = points[Math.ceil(middle)];
  const { left, right, top, bottom } = localBounds(element);
  const [x, y] = rotate(
    [(ax + bx) / 2, (ay + by) / 2],
    (left + right) / 2,
    (top + bottom) / 2,
    element.angle ?? 0,
  );
  return [element.x + x, element.y + y];
}

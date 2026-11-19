import { textWidth } from "./fonts.js";
import { elementBounds, labelAreaFactor, rotate } from "./geometry.js";
import type { Bounds } from "./geometry.js";
import type { Element, Point } from "./types.js";

const shapes = new Set(["rectangle", "ellipse", "diamond"]);
const tolerance = 0.01; // Ignore subpixel rounding in saved scenes.

function checkText(element: Element, parent: Element | undefined, warn: (message: string) => void) {
  const size = element.fontSize ?? 20;
  const lines = element.text!.split("\n");
  const width = lines.reduce((max, line) => Math.max(max, textWidth(line, size, element.fontFamily)), 0);
  const height = lines.length * size * (element.lineHeight ?? 1.25);
  const name = parent ? `label of "${parent.id}"` : `"${element.id}"`;
  if (width > element.width + tolerance || height > element.height + tolerance) {
    warn(`Text overflow in ${name}: the rendered lines exceed the text box. Increase its size or reduce fontSize.`);
    return;
  }
  if (!parent || !shapes.has(parent.type)) return;

  // Compare the label corners in the parent's coordinate system, including off-center labels.
  const cx = parent.x + parent.width / 2;
  const cy = parent.y + parent.height / 2;
  const factor = labelAreaFactor(parent.type);
  const halfWidth = Math.max(0, parent.width * factor / 2 - 5);
  const halfHeight = Math.max(0, parent.height * factor / 2 - 5);
  const corners: Point[] = [[0, 0], [element.width, 0], [element.width, element.height], [0, element.height]];
  const outside = corners.some((corner) => {
    const [x, y] = rotate(corner, element.width / 2, element.height / 2, element.angle ?? 0);
    const [px, py] = rotate([x + element.x - cx, y + element.y - cy], 0, 0, -(parent.angle ?? 0));
    return Math.abs(px) > halfWidth + tolerance || Math.abs(py) > halfHeight + tolerance;
  });
  if (outside) warn(`Text overflow in ${name}: the label extends beyond the shape's padded label area.`);
}

export function checkLayout(elements: Element[], byId: Map<string, Element>, warn: (message: string) => void) {
  const boxes: { name: string; bounds: Bounds }[] = [];
  for (const element of elements) {
    if (element.opacity === 0) continue;
    const parent = element.containerId ? byId.get(element.containerId) : undefined;
    let name = `"${element.id}"`;
    if (element.type === "text") {
      if (!element.text) continue;
      checkText(element, parent, warn);
      // The shape itself accounts for its label when checking pairs.
      if (parent && parent.type !== "arrow") continue;
      if (parent) name = `label of "${parent.id}"`;
    } else if (!shapes.has(element.type) && element.type !== "image") continue;
    boxes.push({ name, bounds: elementBounds(element) });
  }

  boxes.sort((a, b) => a.bounds.left - b.bounds.left);
  let overlaps = 0;
  for (const [i, a] of boxes.entries()) {
    for (let j = i + 1; j < boxes.length; j++) {
      const b = boxes[j];
      if (b.bounds.left >= a.bounds.right - tolerance) break;
      const width = Math.min(a.bounds.right, b.bounds.right) - b.bounds.left;
      const height = Math.min(a.bounds.bottom, b.bounds.bottom) - Math.max(a.bounds.top, b.bounds.top);
      if (width <= tolerance || height <= tolerance) continue;
      if (++overlaps > 20) {
        warn("Additional element overlaps omitted after the first 20 pairs.");
        return;
      }
      warn(`Possible overlap between ${a.name} and ${b.name} (intersecting bounding boxes).`);
    }
  }
}

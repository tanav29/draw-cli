import { randomInt, randomUUID } from "node:crypto";
import { generateNKeysBetween } from "fractional-indexing";
import { textWidth, wrapText } from "./fonts.js";
import { arrowCenter, boundsOf, elementBounds, extents, rotate } from "./geometry.js";
import type { Binding, Element, Label, Point, Scene, Skeleton, Spec } from "./types.js";

function makeElement(skeleton: Skeleton): Element {
  const { label, children, start, end, ...fields } = skeleton;
  const element: Element = {
    x: 0,
    y: 0,
    width: 100,
    height: 100,
    angle: 0,
    strokeColor: "#1e1e1e",
    backgroundColor: "transparent",
    fillStyle: "solid",
    strokeWidth: 2,
    strokeStyle: "solid",
    roughness: 1,
    opacity: 100,
    groupIds: [],
    frameId: null,
    roundness: null,
    seed: randomInt(1, 0x7fffffff),
    version: 1,
    versionNonce: randomInt(1, 0x7fffffff),
    isDeleted: false,
    boundElements: null,
    updated: Date.now(),
    link: null,
    locked: false,
    ...fields,
  };
  if (element.type === "arrow" || element.type === "line") {
    element.points ??= [
      [0, 0],
      [skeleton.width ?? 100, skeleton.height ?? 0],
    ];
    const box = boundsOf(element.points);
    element.width = box.right - box.left;
    element.height = box.bottom - box.top;
    element.startBinding ??= null;
    element.endBinding ??= null;
    element.startArrowhead ??= null;
    element.endArrowhead =
      element.endArrowhead === undefined && element.type === "arrow"
        ? "arrow"
        : (element.endArrowhead ?? null);
    element.lastCommittedPoint = null;
    if (element.type === "arrow") element.elbowed ??= false;
  } else if (element.type === "image") {
    element.scale ??= [1, 1];
    element.status ??= "saved";
    element.crop ??= null;
  } else if (element.type === "frame") {
    element.name ??= null;
  }
  return element;
}

function sizeText(element: Element, maxWidth = Infinity) {
  const fontSize = (element.fontSize ??= 20),
    family = (element.fontFamily ??= 5);
  element.lineHeight ??= 1.25;
  element.originalText ??= element.text ?? "";
  element.text = wrapText(
    element.originalText.replace(/\r\n?/g, "\n").replace(/\t/g, "    "),
    maxWidth,
    fontSize,
    family,
  );
  const lines = element.text.split("\n");
  element.width = lines.reduce((w, line) => Math.max(w, textWidth(line, fontSize, family)), 1);
  element.height = lines.length * fontSize * element.lineHeight;
  element.containerId ??= null;
  element.textAlign ??= "left";
  element.verticalAlign ??= "top";
  element.autoResize ??= true;
}

function makeLabel(container: Element, label: Label, spec: Skeleton): Element {
  const arrow = container.type === "arrow";
  const factor = container.type === "diamond" ? 0.5 : container.type === "ellipse" ? Math.SQRT1_2 : 1;
  const element = makeElement({
    type: "text",
    id: randomUUID(),
    textAlign: "center",
    verticalAlign: "middle",
    strokeColor: container.strokeColor,
    opacity: container.opacity,
    angle: arrow ? 0 : container.angle,
    ...label,
    containerId: container.id,
    frameId: container.frameId,
  });
  sizeText(
    element,
    spec.width === undefined || arrow ? Infinity : Math.max(1, container.width * factor - 10),
  );
  if (!arrow) {
    if (spec.width === undefined) container.width = Math.ceil((element.width + 10) / factor);
    container.height = Math.max(spec.height ?? 0, Math.ceil((element.height + 10) / factor));
  }
  const [cx, cy] = arrow
    ? arrowCenter(container)
    : [container.x + container.width / 2, container.y + container.height / 2];
  const dx =
    arrow || element.textAlign === "center"
      ? 0
      : ((container.width * factor - 10 - element.width) / 2) * (element.textAlign === "left" ? -1 : 1);
  const dy =
    arrow || element.verticalAlign === "middle"
      ? 0
      : ((container.height * factor - 10 - element.height) / 2) * (element.verticalAlign === "top" ? -1 : 1);
  const [x, y] = rotate([cx + dx, cy + dy], cx, cy, element.angle ?? 0);
  element.x = x - element.width / 2;
  element.y = y - element.height / 2;
  (container.boundElements ??= []).push({ id: element.id, type: "text" });
  return element;
}

function bind(arrow: Element, target: Element, side: "start" | "end"): Binding {
  const bindings = (target.boundElements ??= []);
  if (!bindings.some((b) => b.id === arrow.id)) bindings.push({ type: "arrow", id: arrow.id });
  const points = arrow.points!;
  const centerX = target.x + target.width / 2,
    centerY = target.y + target.height / 2;
  const box = boundsOf(points);
  function relativeToTarget(point: Point): Point {
    const [ax, ay] = rotate(point, (box.left + box.right) / 2, (box.top + box.bottom) / 2, arrow.angle ?? 0);
    return rotate([ax + arrow.x - centerX, ay + arrow.y - centerY], 0, 0, -(target.angle ?? 0));
  }
  const [x, y] = relativeToTarget(side === "start" ? points[0] : points.at(-1)!);
  const [px, py] = relativeToTarget(side === "start" ? points[1] : points.at(-2)!);
  const dx = x - px,
    dy = y - py;
  const w = target.width / 2,
    h = target.height / 2;
  const radius =
    target.type === "diamond"
      ? Math.max(Math.abs(dx * h), Math.abs(dy * w))
      : Math.abs(dx * h) + Math.abs(dy * w);
  const focus = radius ? (dx * y - dy * x) / radius : 0;
  const gap = Math.hypot(Math.max(Math.abs(x) - w, 0), Math.max(Math.abs(y) - h, 0));
  return { elementId: target.id, focus, gap };
}

export function createScene(spec: Spec): Scene {
  const elements = spec.elements.map(makeElement);
  const byId = new Map(elements.map((element) => [element.id, element]));
  const labels = new Map<string, Element>();
  for (const skeleton of spec.elements) {
    const element = byId.get(skeleton.id)!;
    if (element.type === "text") sizeText(element, element.autoResize === false ? skeleton.width : undefined);
    else if (skeleton.label?.text) labels.set(element.id, makeLabel(element, skeleton.label, skeleton));
  }
  for (const skeleton of spec.elements) {
    const element = byId.get(skeleton.id)!;
    if (element.type === "arrow") {
      if (skeleton.start) element.startBinding = bind(element, byId.get(skeleton.start.id)!, "start");
      if (skeleton.end) element.endBinding = bind(element, byId.get(skeleton.end.id)!, "end");
    }
    if (element.type === "frame" && skeleton.children) {
      const children = skeleton.children.map((id) => byId.get(id)!);
      for (const child of children) {
        child.frameId = element.id;
        const label = labels.get(child.id);
        if (label) label.frameId = element.id;
      }
      const box = children.length
        ? extents(children.map(elementBounds))
        : { left: 0, top: 0, right: 0, bottom: 0 };
      element.x = skeleton.x ?? box.left - 10;
      element.y = skeleton.y ?? box.top - 10;
      element.width = skeleton.width ?? Math.max(1, box.right + 10 - element.x);
      element.height = skeleton.height ?? Math.max(1, box.bottom + 10 - element.y);
    }
  }
  for (const label of labels.values()) elements.push(label);
  const indices = generateNKeysBetween(null, null, elements.length);
  elements.forEach((element, i) => {
    element.index = indices[i];
  });
  return {
    type: "excalidraw",
    version: 2,
    source: "draw-cli",
    elements,
    appState: { viewBackgroundColor: spec.background },
    files: spec.files,
  };
}

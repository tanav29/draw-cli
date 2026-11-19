import type { Files, Scene, Skeleton, Spec } from "./types.js";

const shapeTypes = new Set(["rectangle", "ellipse", "diamond", "text", "arrow", "line", "frame", "image"]);
const bindableTypes = new Set(["rectangle", "ellipse", "diamond", "text"]);

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function checkNumbers(record: Record<string, unknown>, keys: string[], name: string) {
  for (const key of keys) {
    if (record[key] !== undefined && !Number.isFinite(record[key])) {
      throw new Error(`${name}.${key} must be a finite number.`);
    }
  }
}

function checkFields(record: Record<string, unknown>, name: string) {
  checkNumbers(
    record,
    [
      "x",
      "y",
      "width",
      "height",
      "angle",
      "seed",
      "opacity",
      "roughness",
      "strokeWidth",
      "fontFamily",
      "fontSize",
      "lineHeight",
    ],
    name,
  );
  if (
    record.points !== undefined &&
    (!Array.isArray(record.points) ||
      record.points.some((p) => !Array.isArray(p) || p.length < 2 || !p.every(Number.isFinite)))
  ) {
    throw new Error(`${name}.points must contain finite coordinates.`);
  }
  const crop = record.crop;
  if (crop != null) {
    if (
      !isObject(crop) ||
      !["x", "y", "width", "height", "naturalWidth", "naturalHeight"].every((k) => Number.isFinite(crop[k]))
    ) {
      throw new Error(`${name}.crop must contain finite image dimensions and coordinates.`);
    }
  }
}

export function checkRenderFields(scene: Scene) {
  for (const e of scene.elements) {
    if (!e.isDeleted) checkFields(e, `Element "${e.id}"`);
  }
}

export function validateScene(scene: unknown): Scene {
  if (!isObject(scene) || scene.type !== "excalidraw" || !Array.isArray(scene.elements)) {
    throw new Error('Expected a native scene with "type": "excalidraw" and an "elements" array.');
  }
  if (scene.elements.some((element) => !isObject(element) || typeof element.type !== "string")) {
    throw new Error("The scene contains an invalid element.");
  }
  return scene as unknown as Scene;
}

export function normalizeSpec(spec: unknown): Spec {
  if (!isObject(spec) || !Array.isArray(spec.elements)) {
    throw new Error('Expected a drawing spec with an "elements" array.');
  }
  const background = spec.background ?? "#ffffff";
  if (typeof background !== "string" || !background.trim()) {
    throw new Error("background must be a CSS color string.");
  }
  const files = spec.files ?? {};
  if (!isObject(files)) throw new Error("files must be an object keyed by file ID.");

  const byId = new Map<string, string>();
  const elements = spec.elements.map((element: unknown, index): Skeleton => {
    const name = `elements[${index}]`;
    if (!isObject(element) || typeof element.type !== "string" || !shapeTypes.has(element.type)) {
      throw new Error(`${name}.type must be one of ${[...shapeTypes].join(", ")}.`);
    }
    const id = element.id ?? `element-${index + 1}`;
    if (typeof id !== "string" || !id.trim() || byId.has(id)) {
      throw new Error(`${name}.id must be a unique non-empty string (received ${JSON.stringify(id)}).`);
    }
    byId.set(id, element.type);
    checkFields(element, name);
    for (const key of ["x", "y"]) {
      if (!(element.type === "frame" && element[key] === undefined) && !Number.isFinite(element[key])) {
        throw new Error(`${name}.${key} must be a finite number.`);
      }
    }
    if (element.type === "text" && typeof element.text !== "string") {
      throw new Error(`${name}.text must be a string.`);
    }
    if (element.label !== undefined && (!isObject(element.label) || typeof element.label.text !== "string")) {
      throw new Error(`${name}.label must be an object with a text string.`);
    }
    if (isObject(element.label)) checkFields(element.label, `${name}.label`);
    if (
      element.type === "image" &&
      (typeof element.fileId !== "string" || !Object.hasOwn(files, element.fileId))
    ) {
      throw new Error(`${name}.fileId must reference a file in the spec's files object.`);
    }
    if (element.points !== undefined) {
      const { points } = element;
      if (
        !Array.isArray(points) ||
        points.length < 2 ||
        points.some(
          (point) => !Array.isArray(point) || point.length !== 2 || !point.every(Number.isFinite),
        ) ||
        points[0][0] !== 0 ||
        points[0][1] !== 0
      ) {
        throw new Error(`${name}.points must contain at least two [x, y] pairs and start with [0, 0].`);
      }
    }
    return { ...element, id, type: element.type } as Skeleton;
  });

  for (const element of elements) {
    if (
      element.type === "frame" &&
      (!Array.isArray(element.children) || element.children.some((id) => id === element.id || !byId.has(id)))
    ) {
      throw new Error(`Frame "${element.id}" needs a children array of other element IDs.`);
    }
    if (element.type === "arrow") {
      for (const side of ["start", "end"] as const) {
        const binding = element[side];
        if (
          binding !== undefined &&
          (!isObject(binding) ||
            typeof binding.id !== "string" ||
            !bindableTypes.has(byId.get(binding.id) ?? ""))
        ) {
          throw new Error(
            `Arrow "${element.id}" ${side} must reference a shape or text ID using {"id":"..."}.`,
          );
        }
      }
    }
  }

  return { background, elements, files: files as Files };
}

export function describeScene(scene: Scene) {
  const elements = scene.elements.filter((element) => !element.isDeleted);
  const labels = new Map(
    elements
      .filter((element) => element.type === "text" && element.containerId)
      .map((element) => [element.containerId, element]),
  );
  const items = elements.filter((element) => !element.containerId);
  const count = `${items.length} ${items.length === 1 ? "element" : "elements"}`;
  const lines = [
    `Excalidraw drawing (${count})`,
    `Background: ${scene.appState?.viewBackgroundColor ?? "#ffffff"}`,
  ];

  for (const element of items) {
    const details = [`${element.type} ${JSON.stringify(element.id)}`];
    const label = labels.get(element.id);
    const caption =
      element.originalText ?? element.text ?? label?.originalText ?? label?.text ?? element.name;
    if (typeof caption === "string" && caption) details.push(JSON.stringify(caption));
    const { x, y, width, height } = element;
    if ([x, y].every(Number.isFinite)) details.push(`at (${round(x)}, ${round(y)})`);
    if ([width, height].every(Number.isFinite)) details.push(`${round(width)}×${round(height)}`);
    if (element.startBinding || element.endBinding) {
      const start = element.startBinding?.elementId ?? "(free)";
      const end = element.endBinding?.elementId ?? "(free)";
      details.push(`[${start} -> ${end}]`);
    }
    if (element.frameId) details.push(`in frame ${JSON.stringify(element.frameId)}`);
    lines.push(`- ${details.join(" ")}`);
  }
  return lines.join("\n") + "\n";
}

function round(value: number) {
  return Math.round(value * 10) / 10;
}

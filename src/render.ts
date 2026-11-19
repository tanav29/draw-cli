import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import type { Drawable, Options } from "roughjs/bin/core.js";
import type { RoughGenerator } from "roughjs/bin/generator.js";
import { getStroke } from "perfect-freehand";
import { fontFor, textWidth } from "./fonts.js";
import { arrowCenter, elementBounds, extents, localBounds } from "./geometry.js";
import type { Bounds } from "./geometry.js";
import type { Element, Files, Point, Scene } from "./types.js";
import { checkRenderFields } from "./scene.js";
import { checkLayout } from "./layout.js";

const rough: typeof import("roughjs").default = createRequire(import.meta.url)("roughjs");

interface ExportOptions {
  scene: Scene;
  format: "png" | "svg";
  padding: number;
  scale: number;
  transparent: boolean;
  warn?: (message: string) => void;
}

function escape(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function paint(value: string | undefined, fallback: string) {
  // Only inline paint values belong in a standalone export.
  return value && /^[\w#.,%()+ /-]+$/.test(value) && !/url\s*\(/i.test(value) ? value : fallback;
}

function pathMarkup(generator: RoughGenerator, drawing: Drawable, element: Element) {
  const width = element.strokeWidth ?? 2;
  const dash =
    element.strokeStyle === "dashed"
      ? `${width * 4} ${width * 3}`
      : element.strokeStyle === "dotted"
        ? `1 ${width * 2}`
        : "";
  return generator
    .toPaths(drawing)
    .map((p) => {
      const dashed = dash && p.stroke !== "none" && p.fill === "none" ? ` stroke-dasharray="${dash}"` : "";
      return `<path d="${p.d}" fill="${p.fill ?? "none"}" stroke="${p.stroke}" stroke-width="${p.strokeWidth}" stroke-linecap="round" stroke-linejoin="round"${dashed}/>`;
    })
    .join("");
}

function arrowhead(kind: string | null | undefined, tip: Point, prev: Point, color: string, width: number) {
  if (!kind) return "";
  const dx = tip[0] - prev[0],
    dy = tip[1] - prev[1];
  const length = Math.hypot(dx, dy);
  if (!length) return "";
  const size = Math.min(length / 2, 12 + width * 2);
  const half = size * 0.43;
  const hollow = kind.endsWith("_outline");
  const fill = hollow ? "white" : color;
  let shape: string;
  if (kind.startsWith("crowfoot_")) {
    const fork = kind.includes("many") ? `M0 ${-half} L${-size} 0 L0 ${half}` : "";
    const bar = kind.includes("one") ? `M${-size} ${-half} v${2 * half}` : "";
    shape = `<path d="${fork} ${bar}" fill="none"/>`;
  } else if (kind === "bar") shape = `<path d="M0 ${-half} V${half}"/>`;
  else if (kind === "dot" || kind.startsWith("circle"))
    shape = `<circle cx="${-half}" r="${half}" fill="${fill}"/>`;
  else if (kind.startsWith("diamond"))
    shape = `<path d="M0 0 l${-size / 2} ${half} l${-size / 2} ${-half} l${size / 2} ${-half} Z" fill="${fill}"/>`;
  else {
    const closed = kind.startsWith("triangle");
    shape = `<path d="M${-size} ${-half} L0 0 L${-size} ${half}${closed ? " Z" : ""}" fill="${closed ? fill : "none"}"/>`;
  }
  return `<g transform="translate(${tip}) rotate(${(Math.atan2(dy, dx) * 180) / Math.PI})" stroke="${color}" stroke-width="${width}" stroke-linejoin="round" stroke-linecap="round">${shape}</g>`;
}

function linear(generator: RoughGenerator, element: Element, style: Options) {
  const points = element.points ?? [
    [0, 0],
    [element.width, element.height],
  ];
  if (points.length < 2) return "";
  const first = points[0],
    last = points.at(-1)!;
  const closed = element.type === "line" && first[0] === last[0] && first[1] === last[1];
  let drawing: Drawable;
  if (element.roundness && points.length > 2) drawing = generator.curve(points, style);
  else if (closed) drawing = generator.polygon(points, style);
  else drawing = generator.linearPath(points, style);
  const color = style.stroke!,
    width = style.strokeWidth!;
  return (
    pathMarkup(generator, drawing, element) +
    arrowhead(element.startArrowhead, first, points[1], color, width) +
    arrowhead(
      element.endArrowhead === undefined && element.type === "arrow" ? "arrow" : element.endArrowhead,
      last,
      points.at(-2)!,
      color,
      width,
    )
  );
}

function drawText(element: Element) {
  const font = fontFor(element.fontFamily),
    size = element.fontSize ?? 20;
  const height = size * (element.lineHeight ?? 1.25);
  const align = element.textAlign ?? "left";
  const x = align === "center" ? element.width / 2 : align === "right" ? element.width : 0;
  const anchor = align === "center" ? "middle" : align === "right" ? "end" : "start";
  return (element.text ?? "")
    .split("\n")
    .map(
      (line, i) =>
        `<text x="${x}" y="${(i + 0.5) * height + size * font.baseline}" font-family="${font.family}" font-size="${size}" text-anchor="${anchor}" fill="${paint(element.strokeColor, "#1e1e1e")}" xml:space="preserve">${escape(line)}</text>`,
    )
    .join("");
}

function drawImage(element: Element, files: Files, format: ExportOptions["format"]) {
  const url = element.fileId && files[element.fileId]?.dataURL;
  if (
    !url ||
    !/^data:image\/(?:png|jpe?g|jfif|gif|webp|avif|bmp|x-icon|vnd\.microsoft\.icon|svg\+xml)[;,]/i.test(url)
  ) {
    throw new Error(`Image "${element.id}" needs an embedded image data URL.`);
  }
  const [sx, sy] = element.scale ?? [1, 1];
  if (format === "png" && !/^data:image\/(?:png|jpe?g|jfif|gif|svg\+xml)[;,]/i.test(url)) {
    throw new Error(
      `PNG export cannot decode the image in "${element.id}". Use an embedded PNG, JPEG, GIF or SVG, or export SVG.`,
    );
  }
  const crop = element.crop;
  const href = escape(url.replace(/^data:image\/(?:jpg|jfif)(?=[;,])/i, "data:image/jpeg"));
  let image = `<image width="${crop?.naturalWidth ?? element.width}" height="${crop?.naturalHeight ?? element.height}" preserveAspectRatio="none" xlink:href="${href}"/>`;
  if (crop)
    image = `<svg width="${element.width}" height="${element.height}" viewBox="${crop.x} ${crop.y} ${crop.width} ${crop.height}" preserveAspectRatio="none">${image}</svg>`;
  return `<g transform="translate(${sx < 0 ? element.width : 0} ${sy < 0 ? element.height : 0}) scale(${Math.sign(sx)} ${Math.sign(sy)})">${image}</g>`;
}

function drawElement(
  generator: RoughGenerator,
  element: Element,
  files: Files,
  format: ExportOptions["format"],
) {
  const w = element.width,
    h = element.height;
  const style: Options = {
    seed: element.seed || 1,
    roughness: element.roughness ?? 1,
    stroke: paint(element.strokeColor, "#1e1e1e"),
    strokeWidth: element.strokeWidth ?? 2,
    fill: paint(element.backgroundColor, "transparent"),
    fillStyle: element.fillStyle ?? "solid",
    fixedDecimalPlaceDigits: 2,
    preserveVertices: true,
  };
  if (style.fill === "transparent") delete style.fill;
  switch (element.type) {
    case "text":
      return drawText(element);
    case "image":
      return drawImage(element, files, format);
    case "arrow":
    case "line":
      return linear(generator, element, style);
    case "ellipse":
      return pathMarkup(generator, generator.ellipse(w / 2, h / 2, w, h, style), element);
    case "diamond":
      return pathMarkup(
        generator,
        generator.polygon(
          [
            [w / 2, 0],
            [w, h / 2],
            [w / 2, h],
            [0, h / 2],
          ],
          style,
        ),
        element,
      );
    case "iframe":
    case "embeddable":
    case "rectangle": {
      if (!element.roundness) return pathMarkup(generator, generator.rectangle(0, 0, w, h, style), element);
      const r = Math.max(
        0,
        Math.min(w / 2, h / 2, element.roundness.value ?? Math.min(32, Math.min(w, h) / 4)),
      );
      const d = `M${r} 0 H${w - r} Q${w} 0 ${w} ${r} V${h - r} Q${w} ${h} ${w - r} ${h} H${r} Q0 ${h} 0 ${h - r} V${r} Q0 0 ${r} 0 Z`;
      return pathMarkup(generator, generator.path(d, style), element);
    }
    case "freedraw": {
      const pressures = element.pressures;
      const points = (element.points ?? []).map(([x, y], i) => [
        x,
        y,
        Array.isArray(pressures) ? pressures[i] : 0.5,
      ]);
      const outline = getStroke(points, {
        size: style.strokeWidth! * 4.25,
        simulatePressure: element.simulatePressure !== false,
        last: true,
      });
      return outline.length ? `<polygon points="${outline.join(" ")}" fill="${style.stroke}"/>` : "";
    }
    case "frame":
    case "magicframe":
      return (
        `<rect width="${w}" height="${h}" rx="8" fill="none" stroke="#adb5bd"/>` +
        (element.name
          ? `<text y="-8" font-size="16" font-family="${fontFor().family}" fill="#666">${escape(element.name)}</text>`
          : "")
      );
    default:
      throw new Error(`Cannot render element "${element.id}" of type "${element.type}".`);
  }
}

function transform(element: Element) {
  const { left, right, top, bottom } = localBounds(element);
  return (
    `translate(${element.x} ${element.y})` +
    (element.angle
      ? ` rotate(${(element.angle * 180) / Math.PI} ${(left + right) / 2} ${(top + bottom) / 2})`
      : "")
  );
}

function exportBounds(element: Element) {
  const box = elementBounds(element);
  // Include the stroke and arrow tips when exporting with zero padding.
  let extra =
    element.type === "text" || element.type === "image"
      ? 0
      : (element.strokeWidth ?? 2) / 2 + (element.roughness ?? 1);
  if (element.type === "arrow" || element.startArrowhead || element.endArrowhead) extra += 6;
  if (element.type === "freedraw") extra += (element.strokeWidth ?? 2) * 2;
  if ((element.type === "frame" || element.type === "magicframe") && element.name) {
    box.top -= 26;
    box.right = Math.max(box.right, box.left + textWidth(element.name, 16));
  }
  return {
    left: box.left - extra,
    top: box.top - extra,
    right: box.right + extra,
    bottom: box.bottom + extra,
  };
}

export async function renderScene({ scene, format, padding, scale, transparent, warn }: ExportOptions) {
  checkRenderFields(scene);
  const visible = scene.elements.filter((element) => !element.isDeleted && element.type !== "selection");
  const byId = new Map(visible.map((element) => [element.id, element]));
  const labels = new Map<string, Element>();
  for (const element of visible) {
    const parent = element.containerId ? byId.get(element.containerId) : undefined;
    if (element.type !== "text" || !parent) continue;
    if (parent?.type === "arrow" && parent.points?.length) {
      const [x, y] = arrowCenter(parent);
      labels.set(parent.id, { ...element, x: x - element.width / 2, y: y - element.height / 2, angle: 0 });
    } else labels.set(parent.id, element);
  }
  const elements = visible.flatMap((element) => {
    if (element.containerId && labels.has(element.containerId)) return [];
    const label = labels.get(element.id);
    return label ? [element, label] : [element];
  });
  const frames = new Map(
    elements
      .filter((element) => element.type === "frame" || element.type === "magicframe")
      .map((element, i) => [element.id, { element, clip: `frame-${i}` }]),
  );
  const boxes: Bounds[] = [];
  const fonts = new Map<string, string>();
  let systemFonts = false;
  for (const element of elements) {
    if (![element.x, element.y, element.width, element.height].every(Number.isFinite))
      throw new Error(`Invalid geometry on "${element.id}".`);
    if (!element.frameId || !frames.has(element.frameId)) boxes.push(exportBounds(element));
    if (element.type === "text" || (frames.has(element.id) && element.name)) {
      const font = fontFor(element.fontFamily, format === "svg" ? "woff2" : "ttf");
      if (font.path) fonts.set(font.family, font.path);
      if (!font.path || /[^\x20-\x7e\n]/u.test(element.text ?? element.name ?? "")) systemFonts = true;
    }
  }
  const box = boxes.length ? extents(boxes) : { left: 0, right: 0, top: 0, bottom: 0 };
  const x = box.left - padding,
    y = box.top - padding;
  const width = Math.max(1, box.right - box.left + 2 * padding),
    height = Math.max(1, box.bottom - box.top + 2 * padding);
  const pixelsW = Math.max(1, Math.ceil(width * scale)),
    pixelsH = Math.max(1, Math.ceil(height * scale));
  if (format === "png" && (pixelsW > 16384 || pixelsH > 16384 || pixelsW * pixelsH > 64_000_000)) {
    throw new Error(`PNG would be ${pixelsW}×${pixelsH}. Lower --scale or export SVG.`);
  }

  if (warn) checkLayout(elements, byId, warn);

  const svg = [
    `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${format === "png" ? pixelsW : width}" height="${format === "png" ? pixelsH : height}" viewBox="${x} ${y} ${width} ${height}">`,
  ];
  if (format === "svg" && fonts.size) {
    const styles = Array.from(
      fonts,
      ([name, path]) =>
        `@font-face{font-family:'${name}';src:url(data:font/woff2;base64,${readFileSync(path).toString("base64")}) format('woff2')}`,
    );
    svg.push(`<defs><style>${styles.join("\n")}</style></defs>`);
  }
  if (!transparent)
    svg.push(
      `<rect x="${x}" y="${y}" width="${width}" height="${height}" fill="${paint(scene.appState?.viewBackgroundColor, "#ffffff")}"/>`,
    );
  for (const { element, clip } of frames.values())
    svg.push(
      `<defs><clipPath id="${clip}"><rect transform="${transform(element)}" width="${element.width}" height="${element.height}"/></clipPath></defs>`,
    );
  const generator = rough.generator();
  for (const [i, element] of elements.entries()) {
    const content = drawElement(generator, element, scene.files ?? {}, format);
    let group = `<g transform="${transform(element)}" opacity="${(element.opacity ?? 100) / 100}">${content}</g>`;
    const label = element.type === "arrow" && labels.get(element.id);
    if (label) {
      const id = `arrow-mask-${i}`;
      svg.push(
        `<defs><mask id="${id}" maskUnits="userSpaceOnUse" x="${x}" y="${y}" width="${width}" height="${height}"><rect x="${x}" y="${y}" width="${width}" height="${height}" fill="white"/><rect x="${label.x - 4}" y="${label.y - 4}" width="${label.width + 8}" height="${label.height + 8}"/></mask></defs>`,
      );
      group = `<g mask="url(#${id})">${group}</g>`;
    }
    const frame = element.frameId && frames.get(element.frameId);
    svg.push(frame ? `<g clip-path="url(#${frame.clip})">${group}</g>` : group);
  }
  svg.push("</svg>\n");
  const source = svg.join("");
  if (format === "svg") return source;
  const { Resvg } = await import("@resvg/resvg-js").catch((cause: unknown) => {
    throw new Error(
      "PNG export requires the resvg binary for this platform. Install with npm ci --include=optional or export SVG.",
      { cause },
    );
  });
  return new Resvg(source, {
    font: { fontFiles: [...fonts.values()], loadSystemFonts: systemFonts, defaultFontFamily: "Arial" },
  })
    .render()
    .asPng();
}

import {
  convertToExcalidrawElements,
  exportToCanvas,
  exportToSvg,
  serializeAsJSON,
} from "@excalidraw/excalidraw";

async function createScene(spec) {
  const labels = spec.elements.flatMap((element) => {
    const text = element.type === "text" ? element : element.label;
    return text?.text
      ? [{ type: "text", x: 0, y: 0, text: text.text, fontFamily: text.fontFamily }]
      : [];
  });
  if (labels.length) {
    // Canvas export registers and loads the SDK's fonts. Load them before the
    // final conversion so that text sizing and wrapping use those fonts.
    await exportToCanvas({
      elements: convertToExcalidrawElements(labels),
      getDimensions: () => ({ width: 1, height: 1 }),
    });
  }

  const elements = convertToExcalidrawElements(spec.elements, { regenerateIds: false });
  return serializeAsJSON(elements, { viewBackgroundColor: spec.background }, spec.files, "local");
}

async function renderScene({ scene, format, padding, scale, transparent }) {
  const options = {
    elements: scene.elements,
    files: scene.files ?? {},
    appState: {
      ...scene.appState,
      exportBackground: !transparent,
      exportEmbedScene: false,
      exportScale: 1,
    },
    exportPadding: padding === 0 && scene.elements.every((element) => element.isDeleted) ? 0.5 : padding,
  };

  if (format === "svg") {
    const svg = await exportToSvg(options);
    return svg.outerHTML + "\n";
  }

  const canvas = await exportToCanvas({
    ...options,
    getDimensions(width, height) {
      width = Math.max(1, Math.ceil(width * scale));
      height = Math.max(1, Math.ceil(height * scale));
      if (width > 16384 || height > 16384 || width * height > 64_000_000) {
        throw new Error(`PNG would be ${width}×${height}. Lower --scale or export SVG.`);
      }
      return { width, height, scale };
    },
  });
  const png = canvas.toDataURL("image/png");
  if (!png.startsWith("data:image/png;base64,")) {
    throw new Error("Chromium could not encode the PNG.");
  }
  return png.slice("data:image/png;base64,".length);
}

window.drawRenderer = { createScene, renderScene };

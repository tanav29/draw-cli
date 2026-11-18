---
name: draw-diagram
description: Author compact YAML or JSON specs for Draw CLI, create editable Excalidraw diagrams, and inspect rendered previews. Use for command-driven flowcharts, architecture sketches, and other editable drawings.
---

# Draw diagrams

Write the spec as the editable source. Use YAML for short handwritten specs and JSON when a caller needs structured JSON. Both take the same fields. Run the commands below from the Draw CLI project directory, or use `draw` if the executable is on PATH.

## Build the spec

- Use a top-level `elements` array and optional `background` color. Give shapes descriptive, stable IDs. Elements stack in array order.
- Give each node an explicit position and size. Lay out rows or columns on a consistent grid, align their centers, and leave room for arrows and labels. Start with roughly 180 × 76 nodes and 70 px between them, then adjust for the text and diagram.
- Use `label: {text: …}` inside shapes and `type: text` with `text` for headings or notes. Use short labels and room for multiline text. Use a small palette with colors that indicate meaning and dark, readable text.
- Set `fillStyle: solid` with `backgroundColor` for filled nodes. Use rectangles for steps and diamonds for decisions when those distinctions help.
- Arrows use absolute `x` and `y` for the first point and relative `points` starting at `[0, 0]`. Calculate endpoints from the node bounds and keep them just outside the shapes. Set `start` and `end` to `{id: node-id}` so the arrow stays attached during editor changes. Add bends when a direct route crosses other nodes.
- In YAML, quote hex colors and labels containing `: ` or beginning with `#`. Quote labels like `true`, `null`, and `123` when they are meant to be text.

```yaml
background: "#ffffff"
elements:
  - {id: intake, type: rectangle, x: 0, y: 0, width: 180, height: 76, label: {text: Receive request}, backgroundColor: "#dbeafe", fillStyle: solid}
  - {id: review, type: rectangle, x: 260, y: 0, width: 180, height: 76, label: {text: Review request}}
  - {id: route, type: arrow, x: 188, y: 38, points: [[0, 0], [64, 0]], start: {id: intake}, end: {id: review}}
```

## Render and check

```sh
node cli.mjs create diagram.excalidraw --from diagram.yaml
node cli.mjs render diagram.excalidraw --scale 2
node cli.mjs source diagram.excalidraw
```

Open the PNG with an image-reading tool. Check clipped or awkwardly wrapped text, crosses or overlaps, arrow direction, and contrast. Adjust the spec and rerun `create` and `render` with `--force` for that draft. Use the text summary to confirm labels and connections. Return the preview and editable scene, plus the authored spec if the user needs to regenerate it.

Use `node cli.mjs yaml-to-json diagram.yaml -o diagram.json` when JSON spec output is requested. Use `source --format json` on the scene when the full native Excalidraw JSON is requested. See the project README for setup and additional shape fields.

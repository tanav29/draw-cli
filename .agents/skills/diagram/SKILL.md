---
name: diagram
description: Create editable Excalidraw diagrams from compact YAML specs with Draw CLI and inspect previews.
---

# Draw diagrams

Write `drawing.yaml` for the user's diagram. Run commands from the project directory (or use `draw` on PATH).

- Choose the diagram structure and concise labels to match the request. Use a consistent grid, clear hierarchy, readable colors, and enough space for text and arrows.
- Put elements in stacking order under `elements`; use stable IDs. Set `x`, `y`, `width`, and `height` for nodes. Use `label: {text: ...}` for shape labels and `type: text` for headings or notes.
- Use arrows with absolute `x`, `y` and relative `points` beginning `[0, 0]`. Place endpoints just outside node bounds; use `start` and `end` IDs for editable bindings. Route around nodes.
- Quote hex colors and strings that YAML could interpret as values or syntax, such as `"#fff"`, `"true"`, or `"Status: ready"`.

```yaml
background: "#ffffff"
elements:
  - {id: intake, type: rectangle, x: 0, y: 0, width: 180, height: 76, label: {text: Receive request}, backgroundColor: "#dbeafe"}
  - {id: review, type: rectangle, x: 260, y: 0, width: 180, height: 76, label: {text: Review request}}
  - {type: arrow, x: 188, y: 38, points: [[0, 0], [64, 0]], start: {id: intake}, end: {id: review}}
```

Render with `node cli.mjs render drawing.yaml`. Inspect the temporary image at the returned absolute path for overlaps, wrapping, arrow direction, and contrast; revise and rerender as needed. Use `-o` to save a persistent image. For an editable scene, run `node cli.mjs create drawing.excalidraw --from drawing.yaml`. Return the requested files and the YAML when useful for regeneration. See the README for additional fields.

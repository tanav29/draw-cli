# Draw CLI

Create drawings from JSON, open them in Excalidraw, and export a PNG or SVG to check how they look. The CLI uses the Excalidraw SDK for drawing and image export. It runs locally with headless Chromium and needs no server or account.

## Setup

Requires Node.js 20.19 or newer. Run these commands from the project directory.

```sh
npm ci
npm run setup
```

Run the CLI with `node cli.mjs`. To make `draw` available on your PATH, run `npm link` from this directory.

## Draw and inspect

```sh
node cli.mjs init drawing.json
node cli.mjs create drawing.excalidraw --from drawing.json
node cli.mjs render drawing.excalidraw --scale 2
node cli.mjs source drawing.excalidraw
```

`init` writes a sample spec you can edit. After editing, rerun `create` and `render` with `--force` to regenerate the scene and image. Open `drawing.png` with an image viewer or an agent's image-reading tool. Use `render -o drawing.svg` for SVG, `--padding` to set the margin, and `--transparent` to omit the canvas background.

`source` lists visible elements, labels, geometry, and arrow bindings. Add `--format json` for the complete native scene, including styles and embedded assets. You can also run `render` and `source` on a scene saved by the Excalidraw editor.

Commands that write files report their output path on stderr. Use `-` for stdin or stdout to compose commands.

```sh
node cli.mjs create - --from drawing.json | node cli.mjs source -
```

Use `node cli.mjs --help` for all flags. Run `npm test` after setup to verify the create, inspect, and export workflow.

## YAML and agent skill

YAML uses the same drawing fields as JSON. Use short inline objects for small shapes or block style for longer labels and notes. Quote hex colors in YAML so the `#` is treated as part of the color.

```sh
node cli.mjs init drawing.yaml
node cli.mjs create drawing.excalidraw --from drawing.yaml
node cli.mjs yaml-to-json drawing.yaml -o drawing.json
```

`create` detects `.yaml` and `.yml` files. When piping YAML to `create`, use `--from - --from-format yaml`. The `yaml-to-json` command accepts `-` for stdin and writes JSON to stdout by default.

The project includes a [draw-diagram skill](.agents/skills/draw-diagram/SKILL.md) with a compact example and guidance on layout, readable labels, and arrow routing.

## Write a drawing spec

A spec has an `elements` array and an optional `background` color. Element order controls stacking. Give shapes IDs so you can connect them with arrows.

```json
{
  "background": "#ffffff",
  "elements": [
    { "id": "start", "type": "rectangle", "x": 0, "y": 0, "width": 140, "height": 70,
      "label": { "text": "Start" }, "backgroundColor": "#d3f9d8", "fillStyle": "solid" },
    { "id": "done", "type": "ellipse", "x": 240, "y": 0, "width": 140, "height": 70,
      "label": { "text": "Done" } },
    { "type": "arrow", "x": 148, "y": 35, "points": [[0, 0], [84, 0]],
      "start": { "id": "start" }, "end": { "id": "done" } }
  ]
}
```

- Use `rectangle`, `ellipse`, `diamond`, `text`, `arrow`, `line`, `frame`, or `image`. Give each element an `x` and `y` position. Frames can derive their bounds from the element IDs in `children`.
- Text uses `text`, with optional `fontSize` and `fontFamily`. Shapes and arrows can use `label: { "text": "..." }`.
- Lines and arrows can use `points` relative to their origin. Begin with `[0, 0]`. Use `start` and `end` with shape IDs to keep arrows attached in the editor.
- Use native style fields such as `strokeColor`, `backgroundColor`, `strokeWidth`, `strokeStyle`, `fillStyle`, `roughness`, `opacity`, and `angle` (radians).
- For images, put an Excalidraw binary file record with a data URL under its ID in top-level `files` and set that ID as the image's `fileId`.

See the [complete example spec](examples/agent-loop.json), its [editable scene](examples/agent-loop.excalidraw), and the [rendered PNG](examples/agent-loop.png). The Excalidraw SDK provides more detail on shape, binding, and export options. [Shape API](https://plus.excalidraw.com/docs/sdk/excalidraw/api/excalidraw-element-skeleton) · [Export API](https://plus.excalidraw.com/docs/sdk/excalidraw/api/utils/export)

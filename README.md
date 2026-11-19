# Draw CLI

Create editable Excalidraw drawings from YAML or JSON and export them to SVG or PNG. The TypeScript CLI generates SVG directly in Node.js and loads resvg for PNG export. Both run offline.

## Run without installing

Requires Node.js 20.19 or newer. Run `npx @10xdevs/draw --help` or `bunx @10xdevs/draw --help`. Use `npx @10xdevs/draw skill` (or `bunx @10xdevs/draw skill`) to print the agent skill instructions. Install globally with `npm install -g @10xdevs/draw` to use the `draw` command directly.

## Setup & build

Requires Node.js 20.19 or newer. From the project directory, run

```sh
bun ci && bun run build
```

`bun ci` compiles the TypeScript sources. For a smaller install that only needs scene creation, inspection, YAML and SVG, use `bun ci --omit=optional` to skip the native PNG binary.

Run the CLI with `bun draw`. To make `draw` available on your PATH, run `bun link` from this directory.

## Render a drawing in one command

**Have the agent write `drawing.yaml`**, a compact spec with an `elements` array. This command saves a PNG in the system temporary folder and prints its absolute path.

```sh
bun draw render drawing.yaml
```

The CLI builds the scene in memory and writes the image. For SVG, use `node cli.mjs render drawing.yaml -o drawing.svg`. For a persistent file, pass `-o path.png`; add `--force` to replace an existing file. Use `--scale 2` for a higher-resolution PNG, `--padding` to set the margin, or `--transparent` to omit the background.

To try the included spec, run

```sh
bun draw render examples/agent-loop.json -o preview.png
```

### Which file should the agent use?

| File | When to use it |
| --- | --- |
| `drawing.yaml` or `.yml` | The default spec to write and revise. See the [drawing spec](#write-a-drawing-spec), or run `node cli.mjs init` for a starter. |
| `drawing.json` | The same spec in JSON, also supported for existing workflows. |
| `drawing.excalidraw` | The native file for editing in Excalidraw. Render an existing one with `node cli.mjs render drawing.excalidraw`. To generate one from a spec, use `node cli.mjs create drawing.excalidraw --from drawing.yaml`. |

### Inspect a scene or use a pipe

`node cli.mjs source drawing.excalidraw` lists visible elements, labels, geometry, and arrow bindings. Add `--format json` for the full native scene, including styles and embedded assets.

Render without `-o` prints its temporary image path on stdout; explicit output paths are reported on stderr. Use `-` as the input to read a YAML or JSON spec from stdin (or scene JSON for `source`), and `-o -` to send the image to stdout. For example, an agent can pipe a YAML spec into `node cli.mjs render - -o preview.svg`. For SVG on stdout, use `-o - --format svg`.

Use `node cli.mjs render --help` for rendering options or `node cli.mjs --help` for all commands. Run `npm test` after a full install to verify the workflow.

## YAML and agent skill

YAML uses the same drawing fields as JSON. Use short inline objects for small shapes or block style for longer labels and notes. Quote hex colors in YAML so the `#` is treated as part of the color.

```sh
bun draw init
bun draw render drawing.yaml
bun draw create drawing.excalidraw --from drawing.yaml
```

`render` and `create` detect `.yaml` and `.yml` files. Stdin defaults to YAML, which also accepts JSON. Use `--from-format json` for strict JSON parsing. The optional `yaml-to-json` command writes JSON to stdout by default.

The project includes a [diagram skill](.agents/skills/diagram/SKILL.md) with a compact example and guidance on layout, readable labels, and arrow routing.

## Write a drawing spec

A spec has an `elements` array and an optional `background` color. Element order controls stacking. Give shapes IDs so you can connect them with arrows.

```yaml
background: "#ffffff"
elements:
  - {id: start, type: rectangle, x: 0, y: 0, width: 140, height: 70, label: {text: Start}, backgroundColor: "#d3f9d8"}
  - {id: done, type: ellipse, x: 240, y: 0, width: 140, height: 70, label: {text: Done}}
  - {type: arrow, x: 148, y: 35, points: [[0, 0], [84, 0]], start: {id: start}, end: {id: done}}
```

- Use `rectangle`, `ellipse`, `diamond`, `text`, `arrow`, `line`, `frame`, or `image`. Give each element an `x` and `y` position. Frames can derive their bounds from the element IDs in `children`.
- Text uses `text`, with optional `fontSize` and `fontFamily`. Shapes and arrows can use `label: { "text": "..." }`.
- Lines and arrows can use `points` relative to their origin. Begin with `[0, 0]`. Use `start` and `end` with shape IDs to keep arrows attached in the editor.
- Use native style fields such as `strokeColor`, `backgroundColor`, `strokeWidth`, `strokeStyle`, `fillStyle`, `roughness`, `opacity`, and `angle` (radians).
- For images, put an Excalidraw binary file record with a data URL under its ID in top-level `files` and set that ID as the image's `fileId`.

### Shape labels and text styling

For a rectangle, ellipse, diamond, or arrow, put the text fields inside `label`. Draw creates an editable text element bound to that shape. For a heading, caption, or note, use `type: text` and put the same fields directly on the element.

| Field | Values | Default and behavior |
| --- | --- | --- |
| `text` | String, required for a text element or a label | Newlines start new lines. Use YAML `|-` for a multiline string without a trailing blank line. An empty label creates no bound text. |
| `fontSize` | Number, in scene pixels | `20` |
| `fontFamily` | Numeric font ID | `5` Excalifont. Bundled alternatives are `1` Virgil, `3` Cascadia Code, `6` Nunito, `7` Lilita One, and `8` Comic Shanns. Other IDs request Arial at render time and use Nunito metrics for layout. |
| `lineHeight` | Number, as a multiplier of `fontSize` | `1.25`. A size of 20 and a line height of 1.5 allocate 30 pixels per line. |
| `textAlign` | `left`, `center`, `right` | Standalone text defaults to `left`, labels to `center`. Aligns lines within the text block and positions a shape label horizontally. Arrow labels stay centered on the route. |
| `verticalAlign` | `top`, `middle`, `bottom` | Shape labels default to `middle` within the available area. Standalone text grows down from `y` (default `top`). Arrow labels stay vertically centered on the route. |
| `strokeColor` | CSS color string | Standalone text defaults to `"#1e1e1e"`. A label inherits its shape's stroke color unless overridden. Quote hex colors in YAML. |

Set `opacity` (0–100, default 100) and `angle` (radians, default 0) on the shape or standalone text element. Shape labels inherit both. Arrow labels inherit opacity and stay upright. Set font and alignment fields inside the label itself.

**Sizing and wrapping.** With an explicit shape width, Draw wraps labels within the usable width, splitting long words when needed. Without a width, the shape grows to fit the longest line. The usable label area is a centered rectangle spanning the full dimensions for rectangles, about 71% of each dimension for ellipses, and 50% for diamonds, with another 5 pixels of padding per side. A specified shape height is a minimum. Arrow labels use their natural width and sit at the middle vertex or the midpoint of the middle segment.

Standalone text sizes itself to its contents. Set `autoResize: false` and `width` together to wrap at that width. Draw measures the resulting lines to set the final width and height. For example, this card has a top-left label and a separate width-limited caption.

```yaml
elements:
  - id: review
    type: rectangle
    x: 0
    y: 0
    width: 240
    height: 90
    backgroundColor: "#e4f3eb"
    label:
      text: |-
        Editorial review
        Due Thursday
      fontFamily: 6
      fontSize: 20
      lineHeight: 1.4
      textAlign: left
      verticalAlign: top
      strokeColor: "#204b40"
  - {id: note, type: text, x: 0, y: 110, autoResize: false, width: 240, fontSize: 16, text: Copy and artwork go to production together.}
```

### Render warnings

`draw render` reports layout warnings on stderr and still writes the image. Warnings identify elements by ID, including generated IDs such as `element-1` when a spec omits them. Use `--no-warnings` for intentional layering or to silence diagnostics in a pipeline.

- **Text overflow** reports when a label expands a specified shape height, a character exceeds a standalone text element's wrapping width, or a saved text block exceeds its box or its shape's padded label area. Increase the affected dimension, shorten the text, or reduce `fontSize`. Ordinary line wrapping that fits is silent.
- **Possible overlap** names pairs with intersecting bounding boxes among shapes, images, standalone text, and arrow labels. Touching edges are fine. Frames, connector paths, and labels inside their own shapes are excluded from pair checks. Rotated shapes, curved outlines, and intentionally layered objects can produce warnings even when the result looks right. Draw lists up to 20 pairs.

### Worked examples

| Spec | What to look at |
| --- | --- |
| [Publication handoff](examples/publication-handoff.yaml) | Two named frames with auto-sized bounds. Each owns its internal arrow. The labeled handoff belongs to the scene so it can cross between frames. |
| [Cache read](examples/cache-read.yaml) | A diamond branches into hit and miss paths. The return arrow turns at a waypoint and uses a negative final y offset to enter the response from below. |
| [Agent drawing loop](examples/agent-loop.json) | Three labeled nodes, two bound arrows, and separate monospace captions in JSON. |

Run `node cli.mjs render examples/cache-read.yaml` for a preview or `node cli.mjs create cache-read.excalidraw --from examples/cache-read.yaml` to edit the scene.

## Export compatibility

The renderer uses Rough.js for sketch strokes and embeds the bundled drawing fonts used by each SVG. Editor exports can differ in line wrapping, stroke geometry, frame titles and font fallback. Linked web embeds render as outlines.

PNG export decodes embedded PNG, JPEG, GIF and SVG images. For scenes containing WebP, AVIF, BMP or ICO assets, export to SVG to retain the original image. PNG output is limited to 16,384 pixels per side and 64 megapixels overall.

## Performance

Saving the included example to a new file took **88 ms for an editable scene**, **95 ms for SVG**, and **124 ms for PNG**. These are median times from seven fresh CLI processes on Windows x64 with Node.js 24.21.0, measured from launch through file write and process exit. Scene creation used the [example spec](examples/agent-loop.json). Both exports used an existing scene at default settings.

The before-and-after benchmark used the same inputs and measured seven fresh processes per command, with both versions writing to stdout.

| Command | Chromium renderer | TypeScript renderer | Time saved per command | Speedup |
| --- | ---: | ---: | ---: | ---: |
| Create editable scene | 1,196 ms | 74 ms | 1,122 ms | 16.2× |
| Export SVG | 1,193 ms | 77 ms | 1,116 ms | 15.5× |
| Export PNG | 1,030 ms | 95 ms | 935 ms | 10.8× |

On Windows x64, the packed CLI and its production dependencies occupy **6.5 MB** with PNG support, or **1.9 MB** with the native PNG binary omitted. The previous version used **239 MB** for dependencies alone and required a separate Chromium download. Source checkouts also install the TypeScript compiler for development.

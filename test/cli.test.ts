import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { inflateSync } from "node:zlib";

const cli = fileURLToPath(new URL("../../cli.mjs", import.meta.url));

interface RunOptions {
  cwd?: string;
  input?: string | Buffer;
}

function run(args: string[], { cwd, input }: RunOptions = {}) {
  const result = spawnSync(process.execPath, [cli, ...args], {
    cwd,
    input,
    timeout: 30_000,
    maxBuffer: 8 * 1024 * 1024,
  });
  if (result.error) throw result.error;
  return result;
}

function success(args: string[], options?: RunOptions) {
  const result = run(args, options);
  assert.equal(result.status, 0, result.stderr.toString());
  return result.stdout;
}

// A 1×1 RGBA PNG has one scanline. All PNG filters predict zero for its first pixel.
function singlePixel(png: Buffer) {
  assert.equal(png.readUInt32BE(16), 1);
  assert.equal(png.readUInt32BE(20), 1);
  assert.equal(png[25], 6);
  const chunks = [];
  for (let i = 8; i < png.length; ) {
    const length = png.readUInt32BE(i);
    if (png.toString("ascii", i + 4, i + 8) === "IDAT") chunks.push(png.subarray(i + 8, i + 8 + length));
    i += length + 12;
  }
  return [...inflateSync(Buffer.concat(chunks)).subarray(1)];
}

test("render existing editor files and enforce PNG export bounds", async () => {
  const fixture = new URL("../../examples/agent-loop.excalidraw", import.meta.url);
  const input = await readFile(fixture);
  const svg = success(["render", "-", "-o", "-", "--format", "svg"], { input }).toString();
  assert.match(svg, /The agent drawing loop/);
  assert.match(svg, /fill="#fbf9f4"/);
  const large = JSON.stringify({
    type: "excalidraw",
    elements: [{ id: "big", type: "rectangle", x: 0, y: 0, width: 16000, height: 8000 }],
  });
  const overLimit = run(["render", "-", "-o", "-"], { input: large });
  assert.equal(overLimit.status, 1);
  assert.equal(overLimit.stdout.length, 0);
  assert.match(overLimit.stderr.toString(), /Lower --scale or export SVG/);
});

test("encode background, transparency and a cropped embedded image into actual pixels", () => {
  const scene = { type: "excalidraw", appState: { viewBackgroundColor: "#123456" }, elements: [] };
  const args = ["render", "-", "-o", "-", "--padding", "0"];
  const input = JSON.stringify(scene);
  assert.deepEqual(singlePixel(success(args, { input })), [0x12, 0x34, 0x56, 255]);
  assert.deepEqual(singlePixel(success([...args, "--transparent"], { input })), [0, 0, 0, 0]);

  const cropped = {
    ...scene,
    elements: [
      {
        id: "i",
        type: "image",
        fileId: "file",
        x: -20,
        y: -5,
        width: 1,
        height: 1,
        crop: { x: 1, y: 0, width: 1, height: 1, naturalWidth: 2, naturalHeight: 1 },
      },
    ],
    files: {
      file: {
        dataURL:
          "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAIAAAABCAIAAAB7QOjdAAAAD0lEQVR4nGP4z8DAwPAfAAcAAf9+CLHQAAAAAElFTkSuQmCC",
      },
    },
  };
  assert.deepEqual(singlePixel(success(args, { input: JSON.stringify(cropped) })), [0, 0, 255, 255]);
});

test("keep frame membership, reciprocal bindings, multiline labels and SVG escaping", () => {
  const spec = {
    elements: [
      { id: "frame", type: "frame", name: "Flow & layout", children: ["box", "edge"] },
      { id: "box", type: "diamond", x: -100, y: 0, width: 100, height: 80, label: { text: "First\nNext" } },
      {
        id: "edge",
        type: "arrow",
        x: 50,
        y: 10,
        points: [
          [0, 0],
          [-35, 18],
        ],
        end: { id: "box" },
        label: { text: "x < y" },
      },
    ],
  };
  const input = success(["create", "-", "--from", "-"], { input: JSON.stringify(spec) });
  const scene: import("../src/types.js").Scene = JSON.parse(input.toString());
  const box = scene.elements.find((e) => e.id === "box");
  assert.equal(box?.frameId, "frame");
  assert.ok(box.boundElements?.some((e) => e.id === "edge"));
  assert.ok(
    scene.elements.some(
      (e) => e.containerId === "box" && e.frameId === "frame" && e.originalText === "First\nNext",
    ),
  );
  const svg = success(["render", "-", "-o", "-", "--format", "svg"], { input }).toString();
  assert.match(svg, /Flow &amp; layout/);
  assert.match(svg, /x &lt; y/);
  assert.match(svg, /clip-path=/);
  assert.match(svg, /<mask /);
});

test("create, inspect, and export a native Excalidraw drawing", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "draw-cli-"));
  try {
    success(["init", "drawing.json"], { cwd });
    const spec = await readFile(join(cwd, "drawing.json"));
    const sceneBytes = success(["create", "-", "--from", "-"], { cwd, input: spec });
    const scene: import("../src/types.js").Scene = JSON.parse(sceneBytes.toString());
    assert.equal(scene.type, "excalidraw");
    assert.equal(scene.source, "draw-cli");
    const arrow = scene.elements.find((element) => element.id === "create-arrow");
    assert.ok(arrow?.startBinding && arrow.endBinding);
    assert.equal(arrow.startBinding.elementId, "write");
    assert.equal(arrow.endBinding.elementId, "create");

    const input = { cwd, input: sceneBytes };
    const summary = success(["source", "-"], input).toString();
    assert.match(summary, /"Write a spec"/);
    assert.match(summary, /\[write -> create\]/);
    assert.deepEqual(success(["source", "-", "--format", "json"], input), sceneBytes);

    success(["render", "-", "--output", "preview.png", "--scale", "2"], input);
    const png = await readFile(join(cwd, "preview.png"));
    assert.deepEqual(png.subarray(0, 8), Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    assert.ok(png.readUInt32BE(16) > 1000);
    const svg = success(["render", "-", "--output", "-", "--format", "svg", "--transparent"], input);
    assert.match(svg.toString(), /^<svg[\s>]/);
    assert.match(svg.toString(), /The agent drawing loop/);
    assert.match(svg.toString(), /data:.*base64,/);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("protect existing files and report invalid arrow references", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "draw-cli-"));
  try {
    success(["init"], { cwd });
    const before = await readFile(join(cwd, "drawing.json"));
    const duplicate = run(["init"], { cwd });
    assert.equal(duplicate.status, 1);
    assert.match(duplicate.stderr.toString(), /already exists/);
    assert.deepEqual(await readFile(join(cwd, "drawing.json")), before);
    success(["init", "--force"], { cwd });

    const input = JSON.stringify({ elements: [{ type: "arrow", x: 0, y: 0, end: { id: "missing" } }] });
    const invalid = run(["create", "-", "--from", "-"], { cwd, input });
    assert.equal(invalid.status, 1);
    assert.equal(invalid.stdout.length, 0);
    assert.match(invalid.stderr.toString(), /end must reference a shape or text ID/);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("convert YAML and create the same drawing from a file or stdin", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "draw-cli-"));
  try {
    success(["init"], { cwd });
    success(["init", "drawing.yml"], { cwd });
    const json = await readFile(join(cwd, "drawing.json"));
    const yaml = await readFile(join(cwd, "drawing.yml"));
    assert.match(yaml.toString(), /^background:/);
    const converted = success(["yaml-to-json", "drawing.yml"], { cwd });
    assert.deepEqual(JSON.parse(converted.toString()), JSON.parse(json.toString()));

    const fromFile = success(["create", "-", "--from", "drawing.yml"], { cwd });
    const fromStdin = success(["create", "-", "--from", "-", "--from-format", "yaml"], { cwd, input: yaml });
    assert.deepEqual(
      success(["source", "-"], { input: fromFile }),
      success(["source", "-"], { input: fromStdin }),
    );
    const invalid = run(["yaml-to-json", "-"], { input: "x: 1\nx: 2\n" });
    assert.equal(invalid.status, 1);
    assert.equal(invalid.stdout.length, 0);
    assert.match(invalid.stderr.toString(), /Invalid YAML in stdin.*unique/);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});
